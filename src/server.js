const net = require('net');
const fs = require('fs');
const path = require('path');
const udpRelay = require('./udprelay');
const utils = require('./utils');
const inet = require('./inet');
const Encryptor = require('./encrypt').Encryptor;

exports.main = () => {

  console.log(utils.version);
  let configFromArgs = utils.parseArgs(true);
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

  let timeout = Math.floor(config.timeout * 1000) || 300000;
  let portPassword = config.port_password;
  let port = config.server_port;
  let key = config.password;
  const METHOD = config.method;
  const SERVER = config.server;

  if (!(SERVER && (port || portPassword) && key)) {
    utils.warn('config.json not found, you have to specify all config in commandline');
    process.exit(1);
  }
  let connections = 0;
  if (portPassword) {
    if (port || key) {
      utils.warn('warning: port_password should not be used with server_port and password. server_port and password will be ignored');
    }
  } else {
    portPassword = {
      [port.toString()]: key,
    };
  }
  let results = [], servers;
  for ([port, key] of Object.entries(portPassword)) {
    servers = SERVER;
    if (!Array.isArray(servers)) {
      servers = [servers];
    }
    results.push((function(){
      return servers.map(serverIp => {
        return (function(){
          utils.info(`calculating ciphers for port ${port}`);
          let server = net.createServer(connection => {
            connections += 1;
            let encryptor = new Encryptor(key, METHOD);
            let stage = 0;
            let headerLength = 0;
            let remote = null;
            let cachedPieces = [];
            let addrLen = 0;
            let remoteAddr = null;
            let remotePort = null;
            utils.debug(`connections: ${connections}`);
            let clean = () => {
              utils.debug('clean');
              connections -= 1;
              remote = null;
              connection = null;
              encryptor = null;
              return utils.debug(`connections: ${connections}`);
            };
            connection.on('data', data => {
              let addrtype, addrLen;
              utils.log(utils.EVERYTHING, 'connection on data');
              try {
                data = encryptor.decrypt(data);
              } catch (error) {
                utils.error(error);
                if (remote) {
                  remote.destroy();
                }
                if (connection) {
                  connection.destroy();
                }
                return;
              }
              if (stage === 5) {
                if (!remote.write(data)) {
                  connection.pause();
                }
                return;
              }
              if (stage === 0) {
                try {
                  addrtype = data[0];
                  if (addrtype === void 0) {
                    return;
                  }
                  if (addrtype === 3) {
                    addrLen = data[1];
                  } else if (addrtype !== 1 && addrtype !== 4) {
                    utils.error(`unsupported addrtype: ${addrtype} maybe wrong password`);
                    connection.destroy();
                    return;
                  }
                  if (addrtype === 1) {
                    remoteAddr = utils.inetNtoa(data.slice(1, 5));
                    remotePort = data.readUInt16BE(5);
                    headerLength = 7;
                  } else if (addrtype === 4) {
                    remoteAddr = utils.inetNtoa(data.slice(1, 17));
                    remotePort = data.readUInt16BE(17);
                    headerLength = 19;
                  } else {
                    remoteAddr = data.slice(2, 2 + addrLen).toString('binary');
                    remotePort = data.readUInt16BE(2 + addrLen);
                    headerLength = 2 + addrLen + 2;
                  }
                  connection.pause();
                  remote = net.connection(remotePort, remoteAddr, () => {
                    let piece;
                    utils.info(`connecting ${remoteAddr}:${remotePort}`);
                    if (!encryptor || !remote || !connection) {
                      if (remote) {
                        remote.destroy();
                      }
                      return;
                    }
                    i = 0;
                    connection.resume();
                    while (i < cachedPieces.length) {
                      piece = cachedPieces[i];
                      remote.write(piece);
                      i += 1;
                    }
                    cachedPieces = null;
                    remote.setTimeout(timeout, () => {
                      utils.debug('remote on timeout during connect()');
                      if (remote) {
                        remote.destroy();
                      }
                      if (connection) {
                        return connection.destroy();
                      }
                    });
                    stage = 5;
                    return utils.debug('stage = 5');
                  });
                  remote.on('data', data => {
                    utils.log(utils.EVERYTHING, 'remote on data');
                    if (!encryptor) {
                      if (remote) {
                        remote.destroy();
                      }
                      return;
                    }
                    data = encryptor.encrypt(data);
                    if (!connection.write(data)) {
                      return remote.pause();
                    }
                  });
                  remote.on('end', () => {
                    utils.debug('remote on end');
                    if (connection) {
                      return connection.end();
                    }
                  });
                  remote.on('error', e => {
                    utils.debug('remote on error');
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
                  remote.setTimeout(15 * 1000, () => {
                    utils.debug('remote on timeout during connect()');
                    if (remote) {
                      remote.destroy();
                    }
                    if (connection) {
                      return connection.destroy();
                    }
                  });
                  if (data.length > headerLength) {
                    let buf = new Buffer(data.length - headerLength);
                    data.copy(buf, 0, headerLength);
                    cachedPieces.push(buf);
                    buf = null;
                  }
                  stage = 4;
                  return utils.debug('stage = 4');
                } catch (error) {
                  utils.error(error);
                  connection.destroy();
                  if (remote) {
                    return remote.destroy();
                  }
                }
              } else {
                if (stage === 4) {
                  return cachedPieces.push(data);
                }
              }
            });
            connection.on('end', () => {
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
              if (remote) {
                return remote.resume();
              }
            });
            return connection.setTimeout(timeout, () => {
              utils.debug('connect on timeout');
              if (remote) {
                remote.destroy();
              }
              if (connection) {
                return connection.destroy();
              }
            });
          });
          server.listen(port, serverIp, () => {
            return utils.info(`server listening at ${serverIp}:${port} `);
          });
          udpRelay.createServer(serverIp, port, null, null, key, METHOD, timeout, false);
          return server.on('error', e => {
            if (e.code === 'EADDRINUSE') {
              utils.error('Address in use, aborting');
            } else {
              utils.error(e);
            }
            return process.stdout.on('drain', () => {
              return process.exit(1);
            });
          });
        })();
      })
    })());
  }
  return results;

};