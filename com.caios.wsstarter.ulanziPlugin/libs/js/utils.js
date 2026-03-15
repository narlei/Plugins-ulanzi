const Utils = {
  getQueryParams(key) {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  },
  getLanguage() {
    return (navigator.language || "en").toLowerCase();
  },
  adaptLanguage(language) {
    if (!language) return "en";
    const short = language.replace("-", "_");
    if (short.toLowerCase().startsWith("zh")) return "zh_CN";
    return "en";
  },
  log(...args) {
    console.log(...args);
  },
  warn(...args) {
    console.warn(...args);
  },
  error(...args) {
    console.error(...args);
  },
  debounce(fn, wait = 250) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  },
  getFormValue(form) {
    const result = {};
    if (!form) return result;
    const fields = form.querySelectorAll("input, textarea, select");
    fields.forEach((field) => {
      if (!field.name) return;
      result[field.name] = field.value;
    });
    return result;
  },
  setFormValue(values, form) {
    if (!form || !values) return;
    Object.keys(values).forEach((key) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = values[key];
    });
  }
};
