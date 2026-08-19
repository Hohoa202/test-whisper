class PcmWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.targetSampleRate = 16000;
        this.targetBufferSize = 8000; // 500ms
        this.pcmBuffer = new Int16Array(this.targetBufferSize);
        this.bufferOffset = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0];
        const ratio = sampleRate / this.targetSampleRate;
        const outputLength = Math.floor(channelData.length / ratio);

        for (let i = 0; i < outputLength; i++) {
            const sourceIndex = Math.floor(i * ratio);
            let sample = Math.max(-1, Math.min(1, channelData[sourceIndex]));
            const pcm16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

            this.pcmBuffer[this.bufferOffset++] = pcm16;

            if (this.bufferOffset >= this.targetBufferSize) {
                const output = this.pcmBuffer.slice();
                this.port.postMessage(output.buffer, [output.buffer]);
                this.bufferOffset = 0;
            }
        }

        return true;
    }
}

registerProcessor("pcm-worklet-processor", PcmWorkletProcessor);