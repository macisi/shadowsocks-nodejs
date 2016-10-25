const crypto = require('crypto');
const util = require('util');
const { merge_sort } = require('./merge_sort');
const int32Max = Math.pow(2, 32);

const cachedTables = {};

const getTable = (key) => {
  if (cachedTables[key]) {
    return cachedTables[key];
  }
  util.log('calculating ciphers');
  let table = new Array(256);
  let decrypt_table = new Array(256);
  let md5sum = crypto.createHash('md5');
  md5sum.update(key);
  let hash = new Buffer(md5sum.digest(), 'binary');
  let al = hash.readUInt32LE(0);
  let ah = hash.readUInt32LE(4);
  let i = 0;

  while (i < 256) {
    table[i] = i;
    i += 1;
  }

  i = 1;
  while(i < 1024) {
    table = merge_sort(table, (x, y) => {
      return ((ah % (x + i)) * int32Max + al) % (x + i) - ((ah % (y + i)) * int32Max + al) % (y + i);
    });
    i += 1;
  }

  i = 0;
  while (i < 256) {
    decrypt_table[table[i]] = i;
    ++ i;
  }

  result = [table, decrypt_table];
  cachedTables[key] = result;
  return result;
};

const substitute = (table, buf) => {
  let i = 0;
  while (i < buf.length) {
    buf[i] = table[buf[i]];
    i += 1;
  }
  return buf;
};

const bytes_to_key_results = {};

const EVP_BytesToKey = (password, key_len, iv_len) => {
  if (bytes_to_key_results[`${password}:${key_len}:${iv_len}`]) {
    return bytes_to_key_results[`${password}:${key_len}:${iv_len}`];
  }
  let m = [], i = 0, count = 0, md5, data, d;
  while (count < key_len + iv_len) {
    md5 = crypto.createHash('md5');
    data = password;
    if (i > 0) {
      data = Buffer.concat([m[i - 1], password]);
    }
    md5.update(data);
    d = md5.digest();
    m.push(d);
    count += d.length;
    i += 1;
  }
  let ms = Buffer.concat(m);
  let key = ms.slice(0, key_len);
  let iv = ms.slice(key_len, key_len + iv_len);
  bytes_to_key_results[password] = [key, iv];
  return bytes_to_key_results[password];
};

const method_supported = {
  'aes-128-cfb': [16, 16],
  'aes-192-cfb': [24, 16],
  'aes-256-cfb': [32, 16],
  'bf-cfb': [16, 8],
  'camellia-128-cfb': [16, 16],
  'camellia-192-cfb': [24, 16],
  'camellia-256-cfb': [32, 16],
  'cast5-cfb': [16, 8],
  'des-cfb': [8, 8],
  'idea-cfb': [16, 8],
  'rc2-cfb': [16, 8],
  'rc4': [16, 0],
  'rc4-md5': [16, 16],
  'seed-cfb': [16, 16]
};

const create_rc4_md5_cipher = (key, iv, op) => {
  let md5 = crypto.createHash('md5'), rc4_key;
  md5.update(key);
  md5.update(iv);
  rc4_key = md5.digest();
  if (op === 1) {
    return crypto.createCipheriv('rc4', rc4_key, '');
  } else {
    return crypto.createDecipheriv('rc4', rc4_key, '');
  }
};

class Encryptor {
  constructor(key, method) {
    this.key = key;
    this.method = method;
    this.iv_sent = false;
    if (this.method === 'table') {
      this.method = null;
    }
    if (this.method) {
      this.cipher = this.get_cipher();
    } else {
      [this.encryptTable, this.decryptTable] = getTable(key);
    }
  }

  get_cipher_len(method) {
    method = method.toLowerCase();
    return method_supported[method];
  }

  get_cipher(password, method, op, iv) {
    method = method.toLowerCase();
    password = new Buffer(password, 'binary');
    let m = this.get_cipher_len(method);
    if (m) {
      let [key, iv_] = EVP_BytesToKey(password, m[0], m[1]);
      if (!iv) {
        iv = iv_;
      }
      if (op === 1) {
        this.cipher_iv = iv.slice(0, m[1]);
      }
      iv = iv.slice(0, m[1]);
      if (method === 'rc4-md5') {
        return create_rc4_md5_cipher(key, iv, op);
      } else {
        if (op === 1) {
          return crypto.createCipheriv(method, key, iv);
        } else {
          return crypto.createDecipheriv(method, key, iv);
        }
      }
    }
  }

  encrypt(buf) {
    if (this.method) {
      let result = this.cipher.update(buf);
      if (this.iv_sent) {
        return result;
      } else {
        this.iv_sent = true;
        return Buffer.concat([this.cipher_iv, result]);
      }
    } else {
      return substitute(this.encryptTable, buf);
    }
  }

  decrypt(buf) {
    if (this.method) {
      if (!this.decipher) {
        let decipher_iv_len = this.get_cipher_len(this.method)[1];
        let decipher_iv = buf.slice(0, decipher_iv_len);
        this.decipher = this.get_cipher(this.key, this.method, 0, decipher_iv);
        return this.decipher.update(buf.slice(decipher_iv_len));
      } else {
        return this.decipher.update(buf);
      }
    } else {
      return substitute(this.decryptTable, buf);
    }
  }
}

const encryptAll = (password, method, op, data) => {
  if (method === 'table') {
    method = null;
  }
  if (!method) {
    let [encryptTable, decryptTable] = getTable(password);
    if (op === 0) {
      return substitute(decryptTable, data)
    } else {
      return substitute(encryptTable, data)
    }
  } else {
    let result = [], iv;
    method = method.toLowerCase();
    let [keyLen, ivLen] = method_supported[method];
    password = Buffer(password, 'binary');
    let [key, iv_] = EVP_BytesToKey(password, keyLen, ivLen);
    if (op === 1) {
      iv = crypto.randomBytes(ivLen);
      result.push(iv);
    } else {
      iv = data.slice(0, ivLen);
      data = data.slice(ivLen);
    }
    if (method === 'rc4-md5') {
      cipher = create_rc4_md5_cipher(key, iv, op);
    } else {
      if (op === 1) {
        cipher = crypto.createCipheriv(method, key, iv);
      } else {
        cipher = crypto.createDecipheriv(method, key, iv);
      }
    }
    result.push(cipher.update(data));
    result.push(cipher.final());
    return Buffer.concat(result);
  }
}

exports.Encryptor = Encryptor;
exports.getTable = getTable;
exports.encryptAll = encryptAll;