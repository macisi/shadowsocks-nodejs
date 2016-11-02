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
  let udpTypesToListen = [], listenIPType;
  if (!listenAddr) {
    udpTypesToListen = ['udp4', 'udp6'];
  } else {
    listenIPType = net.isIP(listenAddr);
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
    server.on('message', (data, rinfo) => {
      let requestHeaderOffset = 0, frag;
      if (isLocal) {
        requestHeaderOffset = 3;
        frag = data[2];
        if (frag !== 0) {
          utils.debug(`frag:${frag}`);
          utils.warn(`drop a message since frag is not 0`);
          return;
        }
      } else {
        data = decrypt(password, method, data);
        if (data === null) {
          return;
        }
      }
      let headerResult = parseHeader(data, requestHeaderOffset);
      if (headerResult === null) {
        return;
      }
      let addrtype = headerResult[0],
          destAddr = headerResult[1],
          destPort = headerResult[2],
          headerLength = headerResult[3];
      let sendDataOffset, serverAddr, serverPort;
      if (isLocal) {
        sendDataOffset = requestHeaderOffset;
        serverAddr = remoteAddr;
        serverPort = remotePort;
      } else {
        sendDataOffset = headerLength;
        serverAddr = destAddr;
        serverPort = destPort;
      }
      let key = clientKey(rinfo.address, rinfo.port, destAddr, destPort);
      let client = clients.getItem(key);
      if (client === null) {
        let clientUdpType = net.isIP(serverAddr);
        if (clientUdpType === 6) {
          client = dgram.createSocket('udp6');
        } else {
          client = dgram.createSocket('udp4');
        }
        clients.setItem(key, client);
        client.on('message', (data1, rinfo1) => {
          let data2, responseHeader, serverIPBuf;
          if (!isLocal) {
            utils.debug(`UDP recv from ${rinfo1.address}:${rinfo1.port}`);
            serverIPBuf = utils.inetAton(rinfo1.address);
            responseHeader = new Buffer(7);
            responseHeader.write('\x01', 0);
            serverIPBuf.copy(responseHeader, 1, 0, 4);
            responseHeader.writeUInt16BE(rinfo1.port, 5);
            data2 = Buffer.concat([responseHeader, data1]);
            data2 = encrypt(password, method, data2);
            if (data2 == null) {
              return;
            }
          } else {
            responseHeader = new Buffer('\x00\x00\x00');
            data1 = decrypt(password, method, data1);
            if (data1 == null) {
              return;
            }
            headerResult = parseHeader(data1, 0);
            if (headerResult === null) {
              return;
            }
            addrtype = headerResult[0];
            destAddr = headerResult[1];
            destPort = headerResult[2];
            headerLength = headerResult[3];
            utils.debug(`UDP recv from ${destAddr}:${destPort}`);
            data2 = Buffer.concat([responseHeader, data1]);
          }
          return server.send(data2, 0, data2.length, rinfo.port, rinfo.address, (err, bytes) => {
            return utils.debug(`remote to local sent`);
          });
        });
        client.on('error', err => {
          return utils.error(`UDP client error: ${err}`);
        });
        client.on('close', () => {
          utils.debug('UDP client close');
          return clients.delItem(key);
        });
        utils.debug(`pairs: ${Object.keys(clients.dict).length}`);
        let dataToSend = data.slice(sendDataOffset, data.length);
        if (isLocal) {
          dataToSend = encrypt(password, method, dataToSend);
          if (dataToSend === null) return;
        }
        utils.debug(`UDP send to ${destAddr}:${destPort}`);
        return client.send(dataToSend, 0, dataToSend.length, serverPort, serverAddr, (err, bytes) => {
          return utils.debug('local to remote sent');
        });
      }
    });
    server.on('listening', () => {
      let address = server.address();
      return utils.info(`UDP server listening ${address.address}:${address.port}`);
    });
    server.on('close', () => {
      utils.info('UDP server closing');
      return clients.destroy();
    });
    if (listenAddr !== null) {
      server.bind(listenPort, listenAddr);
    } else {
      server.bind(listenPort);
    }
    return server;
  }
};