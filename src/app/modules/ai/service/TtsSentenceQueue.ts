interface TtsSentence {
  index: number;
  speakText: string;
  displayText: string;
}

export class TtsSentenceQueue {
  private sentences: TtsSentence[] = [];
  private sendIndex = 0;
  private finished = false;

  push(speakText: string, displayText: string): void {
    this.sentences.push({
      index: this.sentences.length,
      speakText,
      displayText,
    });
  }

  finish(): void {
    this.finished = true;
  }

  next(): TtsSentence | null {
    return this.sentences[this.sendIndex] ?? null;
  }

  advance(): void {
    this.sendIndex += 1;
  }

  get isDrained(): boolean {
    return this.finished && this.sendIndex >= this.sentences.length;
  }
}
