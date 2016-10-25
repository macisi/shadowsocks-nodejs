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

  

};