using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using WebApplicationBase.Data;
using WebApplicationBase.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDb1Context>(options => options.UseSqlServer(
    builder.Configuration.GetConnectionString("DB1")
));
builder.Services.AddDbContext<AppDb2Context>(options => options.UseSqlServer(
    builder.Configuration.GetConnectionString("DB2")
));

builder.Services.AddSingleton<WhisperService>();
builder.Services.AddHttpClient();
builder.Services.AddControllers();

// Add services to the container.
builder.Services.AddControllersWithViews();
builder.Services.AddHttpContextAccessor();

builder.Services.Configure<FormOptions>(options =>
{
    // Giới hạn cho mỗi HTTP request chunk.
    options.MultipartBodyLengthLimit = 10L * 1024L * 1024L;
});

builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "RequestVerificationToken";
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseRouting();
app.UseStaticFiles();
app.UseWebSockets();
app.MapControllers();

app.Map("/ws/voice", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    var whisper = context.RequestServices.GetRequiredService<WhisperService>();
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
    var cancellationToken = cancellation.Token;

    const int sampleRate = 16000;
    const int bytesPerSample = 2;
    const int channels = 1;
    const int chunkMs = 500;
    const int windowMs = 5000;
    const int expectedChunkBytes = sampleRate * bytesPerSample * channels * chunkMs / 1000;
    const int maxChunks = windowMs / chunkMs;

    var rollingBuffer = new Queue<byte[]>(maxChunks);
    var bufferLock = new object();

    var inferenceChannel = System.Threading.Channels.Channel.CreateBounded<byte[]>(
        new BoundedChannelOptions(1)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.DropOldest
        });

    var receiveTask = ReceiveAudioAsync();
    var snapshotTask = CreateSnapshotsAsync();
    var processTask = ProcessWhisperAsync();

    try
    {
        await Task.WhenAll(receiveTask, snapshotTask, processTask);
    }
    catch (OperationCanceledException) { }
    catch (WebSocketException) { }
    finally
    {
        cancellation.Cancel();
        inferenceChannel.Writer.TryComplete();

        if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
            }
            catch { }
        }
    }

    async Task ReceiveAudioAsync()
    {
        var receiveBuffer = new byte[32 * 1024];

        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var messageBuffer = new MemoryStream();
            WebSocketReceiveResult result;

            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(receiveBuffer), cancellationToken);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    cancellation.Cancel();
                    return;
                }

                if (result.MessageType != WebSocketMessageType.Binary) break;
                await messageBuffer.WriteAsync(receiveBuffer.AsMemory(0, result.Count), cancellationToken);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Binary || messageBuffer.Length == 0) continue;

            var chunk = messageBuffer.ToArray();

            if (chunk.Length != expectedChunkBytes)
            {
                Console.WriteLine($"Unexpected PCM chunk: {chunk.Length} bytes, expected {expectedChunkBytes}");
                continue;
            }

            lock (bufferLock)
            {
                rollingBuffer.Enqueue(chunk);
                if (rollingBuffer.Count > maxChunks) rollingBuffer.Dequeue();
            }
        }
    }

    async Task CreateSnapshotsAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));

        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            byte[] pcmBytes;

            lock (bufferLock)
            {
                if (rollingBuffer.Count == 0) continue;

                var length = rollingBuffer.Sum(x => x.Length);
                pcmBytes = new byte[length];
                var offset = 0;

                foreach (var chunk in rollingBuffer)
                {
                    Buffer.BlockCopy(chunk, 0, pcmBytes, offset, chunk.Length);
                    offset += chunk.Length;
                }
            }

            inferenceChannel.Writer.TryWrite(pcmBytes);
        }
    }

    async Task ProcessWhisperAsync()
    {
        var transcript = "";

        await foreach (var pcmBytes in inferenceChannel.Reader.ReadAllAsync(cancellationToken))
        {
            var stopwatch = Stopwatch.StartNew();
            var windowText = await whisper.TranscribePcm16Async(pcmBytes, cancellationToken);
            stopwatch.Stop();

            windowText = NormalizeText(windowText);
            var audioSeconds = pcmBytes.Length / 32000.0;

            Console.WriteLine($"Window: {audioSeconds:F1}s | Whisper: {stopwatch.ElapsedMilliseconds}ms | Text: {windowText}");

            if (string.IsNullOrWhiteSpace(windowText) || socket.State != WebSocketState.Open) continue;

            transcript = MergeTranscript(transcript, windowText);

            var json = JsonSerializer.Serialize(new
            {
                text = transcript,
                windowText,
                audioSeconds,
                processingMs = stopwatch.ElapsedMilliseconds
            });

            var responseBytes = Encoding.UTF8.GetBytes(json);

            await socket.SendAsync(
                new ArraySegment<byte>(responseBytes),
                WebSocketMessageType.Text,
                true,
                cancellationToken);
        }
    }

    static string NormalizeText(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        return text.Trim().Replace("\r", "").Replace("\n", "");
    }

    static string MergeTranscript(string transcript, string current)
    {
        if (string.IsNullOrWhiteSpace(current)) return transcript;
        if (string.IsNullOrWhiteSpace(transcript)) return current;

        if (transcript.EndsWith(current, StringComparison.Ordinal)) return transcript;
        if (current.StartsWith(transcript, StringComparison.Ordinal)) return current;

        var maxOverlap = Math.Min(transcript.Length, current.Length);

        for (var length = maxOverlap; length >= 2; length--)
        {
            if (transcript.AsSpan(transcript.Length - length).SequenceEqual(current.AsSpan(0, length)))
                return transcript + current[length..];
        }

        return transcript + current;
    }
});


app.UseAuthorization();
app.MapStaticAssets();

app.MapControllerRoute(
    name: "areas",
    pattern: "{area:exists}/{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.MapControllerRoute(
    name: "default",
    pattern: "{area=Voice}/{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.Run();
