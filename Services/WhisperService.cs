using Whisper.net;

namespace WebApplicationBase.Services;

public class WhisperService : IDisposable
{
    private const int SampleRate = 16000;
    private const int Channels = 1;
    private const int BytesPerSample = 2;
    private const double MinimumAudioSeconds = 0.5;

    private readonly WhisperFactory _whisperFactory;
    private readonly WhisperVadFactory _vadFactory;

    public WhisperService(IWebHostEnvironment env)
    {
        //ggml-small.bin
        //ggml-large-v3-turbo.bin
        //ggml-large-v3.bin

        var whisperPath = Path.Combine(env.WebRootPath, "model", "ggml-large-v3.bin");
        var vadPath = Path.Combine(env.WebRootPath, "model", "ggml-silero-v6.2.0.bin");

        if (!File.Exists(whisperPath))
            throw new FileNotFoundException($"Whisper model not found: {whisperPath}", whisperPath);

        if (!File.Exists(vadPath))
            throw new FileNotFoundException($"VAD model not found: {vadPath}", vadPath);

        _whisperFactory = WhisperFactory.FromPath(whisperPath, new WhisperFactoryOptions { UseGpu = true });
        _vadFactory = WhisperVadFactory.FromPath(vadPath);
    }

    public async Task<string> TranscribePcm16Async(
        byte[] pcmBytes,
        CancellationToken cancellationToken = default)
    {
        if (pcmBytes == null || pcmBytes.Length == 0) return string.Empty;

        cancellationToken.ThrowIfCancellationRequested();

        var audioSeconds = pcmBytes.Length / (double)(SampleRate * Channels * BytesPerSample);
        if (audioSeconds < MinimumAudioSeconds) return string.Empty;

        var speechPcm = await ExtractSpeechAsync(pcmBytes, cancellationToken);

        if (speechPcm.Length == 0)
        {
            Console.WriteLine($"VAD: no speech detected ({audioSeconds:F2}s)");
            return string.Empty;
        }

        var speechSeconds = speechPcm.Length / (double)(SampleRate * Channels * BytesPerSample);
        Console.WriteLine($"VAD: {audioSeconds:F2}s -> speech {speechSeconds:F2}s");

        var wavBytes = CreateWavFile(speechPcm);
        await using var stream = new MemoryStream(wavBytes);

        await using var processor = _whisperFactory.CreateBuilder()
            .WithLanguage("ja")
            .Build();

        var texts = new List<string>();

        await foreach (var segment in processor.ProcessAsync(stream, cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!string.IsNullOrWhiteSpace(segment.Text))
                texts.Add(segment.Text.Trim());
        }

        return string.Join("", texts).Trim();
    }

    //private async Task<byte[]> ExtractSpeechAsync(
    //    byte[] pcmBytes,
    //    CancellationToken cancellationToken)
    //{
    //    var wavBytes = CreateWavFile(pcmBytes);
    //    await using var stream = new MemoryStream(wavBytes);

    //    using var vadProcessor = _vadFactory.CreateBuilder()
    //        .WithThreshold(0.5f)
    //        .Build();

    //    var segments = await vadProcessor.DetectSpeechAsync(stream, cancellationToken);

    //    if (segments.Count == 0) return [];

    //    using var speechStream = new MemoryStream();

    //    foreach (var segment in segments)
    //    {
    //        var startSample = (long)(segment.Start.TotalSeconds * SampleRate);
    //        var endSample = (long)(segment.End.TotalSeconds * SampleRate);

    //        var startByte = startSample * BytesPerSample * Channels;
    //        var endByte = endSample * BytesPerSample * Channels;

    //        startByte = Math.Clamp(startByte, 0, pcmBytes.Length);
    //        endByte = Math.Clamp(endByte, 0, pcmBytes.Length);

    //        var length = endByte - startByte;
    //        if (length <= 0) continue;

    //        await speechStream.WriteAsync(
    //            pcmBytes.AsMemory((int)startByte, (int)length),
    //            cancellationToken);
    //    }

    //    return speechStream.ToArray();
    //}

    private async Task<byte[]> ExtractSpeechAsync(byte[] pcmBytes, CancellationToken cancellationToken)
    {
        const int speechPadMs = 300;

        var wavBytes = CreateWavFile(pcmBytes);
        await using var stream = new MemoryStream(wavBytes);

        using var vadProcessor = _vadFactory.CreateBuilder()
            .WithThreshold(0.5f)
            .Build();

        var segments = await vadProcessor.DetectSpeechAsync(stream, cancellationToken);
        if (segments.Count == 0) return [];

        var padBytes = SampleRate * Channels * BytesPerSample * speechPadMs / 1000;
        var ranges = new List<(int Start, int End)>();

        foreach (var segment in segments)
        {
            var startByte = (long)(segment.Start.TotalSeconds * SampleRate) * Channels * BytesPerSample;
            var endByte = (long)(segment.End.TotalSeconds * SampleRate) * Channels * BytesPerSample;

            startByte = Math.Max(0, startByte - padBytes);
            endByte = Math.Min(pcmBytes.Length, endByte + padBytes);

            if (endByte <= startByte) continue;

            var start = (int)startByte;
            var end = (int)endByte;

            if (ranges.Count > 0 && start <= ranges[^1].End)
            {
                var previous = ranges[^1];
                ranges[^1] = (previous.Start, Math.Max(previous.End, end));
            }
            else
            {
                ranges.Add((start, end));
            }
        }

        if (ranges.Count == 0) return [];

        using var speechStream = new MemoryStream();

        foreach (var range in ranges)
        {
            await speechStream.WriteAsync(
                pcmBytes.AsMemory(range.Start, range.End - range.Start),
                cancellationToken);
        }

        return speechStream.ToArray();
    }

    private static byte[] CreateWavFile(byte[] pcmData)
    {
        using var memoryStream = new MemoryStream();
        using var writer = new BinaryWriter(memoryStream);

        const short bitsPerSample = 16;
        var byteRate = SampleRate * Channels * BytesPerSample;
        var blockAlign = Channels * BytesPerSample;
        var dataSize = pcmData.Length;

        writer.Write("RIFF"u8.ToArray());
        writer.Write(36 + dataSize);
        writer.Write("WAVE"u8.ToArray());
        writer.Write("fmt "u8.ToArray());
        writer.Write(16);
        writer.Write((short)1);
        writer.Write((short)Channels);
        writer.Write(SampleRate);
        writer.Write(byteRate);
        writer.Write((short)blockAlign);
        writer.Write(bitsPerSample);
        writer.Write("data"u8.ToArray());
        writer.Write(dataSize);
        writer.Write(pcmData);
        writer.Flush();

        return memoryStream.ToArray();
    }

    public void Dispose()
    {
        _vadFactory.Dispose();
        _whisperFactory.Dispose();
    }
}