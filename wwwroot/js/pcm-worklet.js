class PcmWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.targetSampleRate = 16000;
        this.buffer = [];
    }

    process(inputs) {
        const input = inputs[0];

        if (!input || !input[0]) {
            return true;
        }

        const channelData = input[0];
        const ratio = sampleRate / this.targetSampleRate;
        const outputLength = Math.floor(channelData.length / ratio);
        const pcm16 = new Int16Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const sample = channelData[Math.floor(i * ratio)];
            const s = Math.max(-1, Math.min(1, sample));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

        return true;
    }
}

registerProcessor("pcm-worklet-processor", PcmWorkletProcessor);