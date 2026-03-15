const EventEmitter = {
  _events: {},
  on(name, handler) {
    if (!this._events[name]) this._events[name] = [];
    this._events[name].push(handler);
  },
  emit(name, payload) {
    const handlers = this._events[name] || [];
    handlers.forEach((h) => h(payload));
  }
};
