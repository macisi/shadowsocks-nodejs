const utils = require('./utils');
const inet = require('./inet');
const encryptor = require('./encrypt');

const dgram = require('dgram');
const net = require('net');

class LRUCache {
  constructor(timeout, sweepInterval) {
    this.timeout = timeout;
    let sweepFun = () => {
      this.sweep();
    }
    this.interval = setInterval(sweepFun, sweepInterval);
    this.dict = {}
  }
    
  setItem(key, value) {
    let cur = process.hrtime()
    this.dict[key] = [value, cur];
  }
  
  getItem(key) {
    let v = this.dict[key];
    if (v) {
      v[1] = process.hrtime();
      return v[0];
    }
    return null;
  }
  
  delItem(key) {
    delete this.dict[key];
  }

  destroy() {
    clearInterval(this.interval);
  }
  
  sweep() {
    utils.debug('sweeping');
    let dict = this.dict;
    let keys = Object.keys(dict);
    let swept = 0;
    for (let k of keys) {
      let v = dict[k];
      let diff = process.hrtime(v[1]);
      if (diff[0] > this.timeout * 0.001) {
        swept += 1;
        v[0].close();
        delete dict[k];
      } 
    }
    utils.debug(`${swept} keys swept`);
  }
}

const encrypt = (password, method, data) => {
  try {
    return encryptor.encryptAll(password, method, 1, data);
  } catch(e) {
    utils.error(e);
    return null;
  }
};
  
const decrypt = (password, method, data) => {
  try {
    return encryptor.encryptAll(password, method, 0, data);
  } catch(e) {
    utils.error(e);
    return null;
  }
};

const parseHeader = (data, requestHeaderOffset) => {
  try {
    let addrtype = data[requestHeaderOffset];
    if (addrtype === 3) {
      addrLen = data[requestHeaderOffset + 1];
    } else if (addrtype !== 1 && addrtype !== 4) {
      utils.warn(`unsupported addrtype: ${addrtype}`);
      return null;
    }
    if (addrtype === 1) {
      destAddr = utils.inetNtoa(data.slice(requestHeaderOffset + 1, requestHeaderOffset + 5));
      destPort = data.readUInt16BE(requestHeaderOffset + 5);
      headerLength = requestHeaderOffset + 7;
    } else if (addrtype === 4) {
      destAddr = inet.inet_ntop(data.slice(requestHeaderOffset + 1, requestHeaderOffset + 17));
      destPort = data.readUInt16BE(requestHeaderOffset + 17);
      headerLength = requestHeaderOffset + 19;
    } else {
      destAddr = data.slice(requestHeaderOffset + 2, requestHeaderOffset + 2 + addrLen).toString('binary');
      destPort = data.readUInt16BE(requestHeaderOffset + 2 + addrLen);
      headerLength = requestHeaderOffset + 2 + addrLen + 2;
    }
    return [addrtype, destAddr, destPort, headerLength];
  } catch (e) {
    utils.error(e);
    return null;
  }
};

exports.createServer = (listenAddr, listenPort, remoteAddr, remotePort, password, method, timeout, isLocal) => {
  let udpTypesToListen = [];
  if (!listenAddr) {
    udpTypesToListen = ['udp4', 'udp6'];
  } else {
    listenUPType = net.isIP(listenAddr);
    if (listenIPType === 6) {
      udpTypesToListen.push('udp6');
    } else {
      udpTypesToListen.push('udp4');
    }
  }
  for (let i =0, len = udpTypesToListen.length; i < len; i += 1) {
    let udpTypeToListen = udpTypesToListen[i];
    let server = dgram.createSocket(udpTypeToListen);
    let clients = new LRUCache(timeout, 10 * 1000);
    let clientKey = (localAddr, localPort, destAddr, destPort) => {
      return `${localAddr}:${localPort}:${destAddr}:${destPort}`;
    };
    server.on('message', () => {

    });
  }
};