class UlanziStreamDeck {
  constructor() {
    this.uuid = "";
    this.key = "";
    this.actionid = "";
    this.address = "127.0.0.1";
    this.port = 3906;
    this.websocket = null;
    this.on = EventEmitter.on.bind(EventEmitter);
    this.emit = EventEmitter.emit.bind(EventEmitter);
  }

  connect(uuid) {
    this.uuid = uuid;
    this.port = Utils.getQueryParams("port") || 3906;
    this.address = Utils.getQueryParams("address") || "127.0.0.1";
    this.key = Utils.getQueryParams("key") || "";
    this.actionid = Utils.getQueryParams("actionId") || "";

    this.websocket = new WebSocket(`ws://${this.address}:${this.port}`);
    this.websocket.onopen = () => {
      this.websocket.send(
        JSON.stringify({
          code: 0,
          cmd: Events.CONNECTED,
          actionid: this.actionid,
          key: this.key,
          uuid: this.uuid
        })
      );
      this.emit(Events.CONNECTED, {});
    };

    this.websocket.onmessage = (evt) => {
      const data = evt && evt.data ? JSON.parse(evt.data) : null;
      if (!data || !data.cmd) return;

      if (data.cmd === Events.CLEAR && Array.isArray(data.param)) {
        data.param = data.param.map((item) => ({
          ...item,
          context: this.encodeContext(item)
        }));
      } else {
        data.context = this.encodeContext(data);
      }

      this.emit(data.cmd, data);
    };

    this.websocket.onerror = (err) => this.emit(Events.ERROR, err);
    this.websocket.onclose = () => this.emit(Events.CLOSE, {});
  }

  encodeContext(jsn) {
    return `${jsn.uuid}___${jsn.key}___${jsn.actionid}`;
  }

  decodeContext(context) {
    const [uuid, key, actionid] = String(context || "").split("___");
    return { uuid, key, actionid };
  }

  send(cmd, params) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
    this.websocket.send(
      JSON.stringify({
        cmd,
        uuid: this.uuid,
        key: this.key,
        actionid: this.actionid,
        ...params
      })
    );
  }

  sendParamFromPlugin(settings, context) {
    const parsed = context ? this.decodeContext(context) : {};
    this.send(Events.PARAMFROMPLUGIN, {
      uuid: parsed.uuid || this.uuid,
      key: parsed.key || this.key,
      actionid: parsed.actionid || this.actionid,
      param: settings
    });
  }

  setTitle(context, text) {
    const parsed = this.decodeContext(context);
    this.send(Events.STATE, {
      param: {
        statelist: [
          {
            uuid: parsed.uuid,
            key: parsed.key,
            actionid: parsed.actionid,
            type: 0,
            state: 0,
            textData: text || "",
            showtext: true
          }
        ]
      }
    });
  }

  onConnected(fn) {
    this.on(Events.CONNECTED, fn);
    return this;
  }
  onAdd(fn) {
    this.on(Events.ADD, fn);
    return this;
  }
  onRun(fn) {
    this.on(Events.RUN, fn);
    return this;
  }
  onClear(fn) {
    this.on(Events.CLEAR, fn);
    return this;
  }
  onParamFromApp(fn) {
    this.on(Events.PARAMFROMAPP, fn);
    return this;
  }
  onParamFromPlugin(fn) {
    this.on(Events.PARAMFROMPLUGIN, fn);
    return this;
  }
  onSetActive(fn) {
    this.on(Events.SETACTIVE, fn);
    return this;
  }
}

const $UD = new UlanziStreamDeck();
