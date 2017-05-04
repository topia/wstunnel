module.exports = class BufferHistory {
  constructor(capacity) {
    this.capacity = capacity;
    this.head = 0;
    this.tail = 0;
    this.buffers = [];
    this.head_size = 0;
  }

  pushBuffer(buffer) {
    this.buffers.push(buffer);
    this.tail += buffer.length;
    return this.maintainCapacity();
  };

  maintainCapacity() {
    let head_size;
    const capacity = this.capacity;
    const tail = this.tail;

    if (tail - this.head - this.head_size <= capacity) {
      return;
    }
    while ((tail - this.head - (head_size = this.head_size = this.buffers[0].length)) > capacity) {
      this.buffers.shift();
      this.head += head_size;
    }
  };

  sliceBuffers(begin, end) {
    if (begin < this.head) {
      throw new Error(`cannot slice before head(${this.head}): ${begin}`);
    }
    if (end > this.tail) {
      throw new Error(`cannot slice after tail(${this.tail}): ${end}`);
    }
    let pos = this.head;
    let i = 0;
    const results = [];
    const buffers = this.buffers;
    while (pos < end) {
      const buf = buffers[i++];
      const buf_head = pos;
      const buf_len = buf.length;
      const buf_tail = buf_head + buf_len;
      pos = buf_tail;
      if (buf_tail <= begin) {
        continue;
      }
      const head_in_buf = Math.max(0, begin - buf_head);
      const tail_in_buf = Math.min(buf_len, end - buf_head);
      if (head_in_buf !== 0 || tail_in_buf !== buf_len) {
        results.push(buf.slice(head_in_buf, tail_in_buf));
      } else {
        results.push(buf);
      }
    }
    return results;
  };
};
