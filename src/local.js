const net = require('net');
const fs = require('fs');
const path = require('path');
const udpRelay = require('./udprelay');
const utils = require('./utils');
const inet = require('./inet');
const Encryptor = require('./encrypt').Encryptor;
let connections = 0;

const createServer = (serverAddr, serverPort, port, key, method, timeout, local_address = '127.0.0.1') => {

  let udpServer = udpRelay.createServer(local_address, port, serverAddr, serverPort, key, method, timeout, true);
  let getServer = () => {
    let aPort = serverPort;
    let aServer = serverAddr;
    if (Array.isArray(serverPort)) {
      aPort = serverPort[Math.floor(Math.random() * serverPort.length)];
    }
    if (Array.isArray(serverAddr)) {
      aServer = serverAddr[Math.floor(Math.random() * serverAddr.length)];
    }
    let r = /^([^:]*)\:(\d+)$/.exec(aServer);
    if (r) {
      aServer = r[1];
      aPort = r[2];
    }
    return [aServer, aPort];
  };
  let server = net.createServer(connection => {
    connections += 1;
    let connected = true;
    let encryptor = new Encryptor(key, method);
    let stage = 0;
    let headerLength = 0;
    let remote = null;
    let addrLen = 0;
    let remoteAddr = null;
    let remotePort = null;
    let addrToSend = '';
    utils.debug(`connections: ${connections}`);
    let clean = () => {
      utils.debug('clean');
      connection -= 1;
      remote = null;
      connection = null;
      encryptor = null;
      return utils.debug(`connections: ${connections}`);
    };
    connection.on('data', data => {
      let addrtype, reply;
      utils.log(utils.EVERYTHING, 'connection on data');
      if (stage === 5) {
        data = encryptor.encrypt(data);
        if (!remote.write(data)) {
          connection.pause();
        } 
        return;
      }
      if (stage === 0) {
        tempBuf = new Buffer(2);
        tempBuf.write('\u0005\u0000', 0);
        connection.write(tempBuf);
        stage = 1;
        utils.debug('stage = 1');
        return;
      }
      if (stage === 1) {
        try {
          cmd = data[1];
          addrtype = data[3];
          if (cmd === 1) {
          } else if (cmd === 3) {
            utils.info(`UDP assc request from ${connection.localAddress}:${connection.localPort}`);
            reply = new Buffer(10);
            reply.write('\u0005\u0000\u0000\u0001', 0, 4, 'binary');
            utils.debug(connection.localAddress);
            utils.inetAton(connection.localAddress).copy(reply, 4);
            reply.writeUInt16BE(connection.localPort, 8);
            connection.write(reply);
            stage = 10;
          } else {
            utils.error(`unsupported cmd ${cmd}`);
            reply = new Buffer('\u0005\u0007\u0000\u0001', 'binary');
            connection.end(reply);
            return;
          }
          if (addrtype === 3) {
            addrLen = data[4];
          } else if (addrtype !== 1 && addrtype !== 4) {
            utils.error(`unsupported addrtype: ${addrtype}`);
            connection.destroy();
            return;
          }
          addrToSend = data.slice(3, 4).toString('binary');
          if (addrtype === 1) {
            remoteAddr = utils.inetNtoa(data.slice(4, 8));
            addrToSend += data.slice(4, 10).toString('binary');
            remotePort = data.readUInt16BE(8);
            headerLength = 10;
          } else if (addrtype === 4) {
            remoteAddr = inet.inet_ntop(data.slice(4, 20));
            addrToSend += data.slice(4, 22).toString('binary');
            remotePort = data.readUInt16BE(20);
            headerLength = 22;
          } else {
            remoteAddr = data.slice(5, 5 + addrLen).toString('binary');
            addrToSend += data.slice(4, 5 + addrLen + 2).toString('binary');
            remotePort = data.readUInt16BE(5 + addrLen);
            headerLength = 5 + addrLen + 2;
          }
          if (cmd === 3) {
            utils.info(`UDP assc: ${remoteAddr}:${remotePort}`);
            return;
          }
          let buf = new Buffer(10);
          buf.write('\u0005\u0000\u0000\u0001', 0, 4, 'binary');
          buf.write('\u0000\u0000\u0000\u0000', 4, 4, 'binary');
          buf.writeInt16BE(2222, 8);
          connection.write(buf);
          let [aServer, aPort] = getServer();
          utils.info(`connecting ${aServer}:${aPort}`);
          remote = net.connect(aPort, aServer, () => {
            if (remote) {
              remote.setNoDelay(true);
            }
            stage = 5;
            return utils.debug('stage = 5');
          });
          remote.on('data', data => {
            if (!connected) return;
            utils.log(utils.EVERYTHING, 'remote on data');
            try {
              if (encryptor) {
                data = encryptor.decrypt(data);
                if (!connection.write(data)) {
                  return remote.pause();
                }
              } else {
                return remote.destroy();
              }
            } catch (error) {
              utils.error(error);
              if (remote) {
                remote.destroy();
              }
              if (connection) {
                return connection.destroy();
              }
            }
          });
          remote.on('end', () => {
            utils.debug('remote on end');
            if (connection) {
              return connection.end();
            }
          });
          remote.on('error', e => {
            utils.debug('remote on erro');
            return utils.error(`remote ${remoteAddr}:${remotePort} error: ${e}`);
          });
          remote.on('close', had_error => {
            utils.debug(`remote on close: ${had_error}`);
            if (had_error) {
              if (connection) {
                return connection.destroy();
              }
            } else {
              if (connection) {
                return connection.end();
              }
            }
          });
          remote.on('drain', () => {
            utils.debug('remote on drain');
            if (connection) {
              return connection.resume();
            }
          });
          remote.setTimeout(timeout, () => {
            utils.debug('remote on timeout');
            if (remote) {
              remote.destroy();
            }
            if (connection) {
              return connection.destroy();
            }
          });
          let addrToSendBuf = new Buffer(addrToSend, 'binary');
          addrToSendBuf = encryptor.encrypt(addrToSendBuf);
          remtoe.setNoDelay(false);
          remote.write(addrToSendBuf);
          if (data.length > headerLength) {
            buf = new Buffer(data.length - headerLength);
            data.copy(buf, 0, headerLength);
            piece = encryptor.encrypt(buf);
            remote.write(piece);
          }
          stage = 4;
          return utils.debug('stage = 4');
        } catch (error) {
          utils.error(error);
          if (connection) {
            connection.destroy();
          }
          if (remote) {
            remote.destroy();
          }
          return clean();
        }
      } else if (stage === 4) {
        if (remote === null) {
          if (connection) {
            connection.destroy();
          }
          return;
        }
        data = encryptor.encrypt(data);
        remote.setNoDelay(true);
        if (!remote.write(data)) {
          return connection.pause();
        }
      }
    });
    connection.on('end', () => {
      connected = false;
      utils.debug('connection on end');
      if (remote) {
        return remote.end();
      }
    });
    connection.on('error', e => {
      utils.debug('connection on error');
      return utils.error(`local error: ${e}`);
    });
    connection.on('close', had_error => {
      connected = false;
      utils.debug(`connection on close: ${had_error}`);
      if (had_error) {
        if (remote) {
          remote.destroy();
        }
      } else {
        if (remote) {
          remote.end();
        }
      }
      return clean();
    });
    connection.on('drain', () => {
      utils.debug('connection on drain');
      if (remote && stage === 5) {
        return remote.resume();
      }
    });
    return connection.setTimeout(timeout, () => {
      utils.debug('connection on timeout');
      if (remote) {
        remote.destroy();
      }
      if (connection) {
        return connection.destroy();
      }
    });
  });
  if (local_address) {
    server.listen(port, local_address, () => {
      return utils.info(`local listening at ${server.address().address}:${port}`);
    });
  } else {
    server.listen(port, () => {
      return utils.info(`local listening at 0.0.0.0:${port}`);
    });
  }
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      return utils.error('Address in use, aborting');
    } else {
      return utils.error(e);
    }
  });
  server.on('close', () => {
    return udpServer.close();
  });
  return server;
};

exports.createServer = createServer;

exports.main = () => {
  console.log(utils.version);
  let configFromArgs = utils.parseArgs();
  let configPath = 'config.json';
  let config;
  if (configFromArgs.config_file) {
    configPath = configFromArgs.config_file;
  }
  if (!fs.existsSync(configPath)) {
    configPath = path.resolve(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
      configPath = path.resolve(__dirname, '../../config.json');
      if (!fs.existsSync(configPath)) {
        configPath = null;
      }
    }
  }
  if (configPath) {
    utils.info(`loading config from ${configPath}`);
    let configContent = fs.readFileSync(configPath);
    try {
      config = JSON.parse(configContent);
    } catch (error) {
      utils.error(`found an error in config.json: ${error.message}`);
      process.exit(1);
    }
  } else {
    config = {};
  }
  Object.assign(config, configFromArgs);
  if (config.verbose) {
    utils.config(utils.DEBUG);
  }
  utils.checkConfig(config);
  const SERVER = config.server;
  const REMOTE_PORT = config.server_port;
  const PORT = config.local_port;
  const KEY = config.password;
  const METHOD = config.method;
  let { local_address } = config;
  if (!(SERVER && REMOTE_PORT && PORT && KEY)) {
    utils.warn('config.json not found, you have to specify all config in commandline');
    process.exit(1);
  }
  let timeout = Math.floor(config.timeout * 1000) || 600000;
  let s = createServer(SERVER, REMOTE_PORT, PORT, KEY, METHOD, timeout, local_address);
  return s.on('error', e => {
    return process.stdout.on('drain', () => {
      return process.exit(1);
    });
  });

};