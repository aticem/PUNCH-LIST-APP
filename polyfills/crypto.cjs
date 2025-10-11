// Vite başlamadan önce: crypto.getRandomValues garanti
const { webcrypto } = require('node:crypto');

try {
  const g = globalThis;
  const c = g.crypto;

  if (c && typeof c.getRandomValues !== 'function') {
    // crypto var ama eksik → yöntemi enjekte et
    c.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
  }
  if (c && !c.subtle) {
    c.subtle = webcrypto.subtle;
  }

  // çok nadir: crypto hiç yoksa (eski Node)
  if (!c) {
    g.crypto = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: webcrypto.subtle
    };
  }
} catch (e) {
  console.error('crypto polyfill yüklenemedi:', e);
}
