class DecodedAudioTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(1024);
    this.offset = 0;
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    const samples = inputs[0]?.[0];
    if (!samples) return true;

    let position = 0;
    while (position < samples.length) {
      const count = Math.min(this.frame.length - this.offset, samples.length - position);
      this.frame.set(samples.subarray(position, position + count), this.offset);
      this.offset += count;
      position += count;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('tts-decoded-audio-tap', DecodedAudioTapProcessor);
