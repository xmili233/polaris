import { PolarisError } from '../dist-service/model.js';

export function symbols(names, nativeImage, cache = new Map()) {
  if (!Array.isArray(names) || names.length > 100 || !names.every(name => typeof name === 'string' && name.length <= 100)) throw new PolarisError('invalid_input', 'Missing or invalid desktop parameters.');
  return Object.fromEntries(names.flatMap(name => {
    if (!/^[a-z0-9_.]+$/i.test(name)) return [];
    if (!cache.has(name)) {
      const image = nativeImage.createFromNamedImage(name, { pointSize: 34, weight: 'medium' });
      cache.set(name, image.isEmpty() ? null : image.toDataURL());
    }
    return cache.get(name) ? [[name, cache.get(name)]] : [];
  }));
}
