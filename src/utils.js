const util = require('util');
const pack = require('../package.json');

const printLocalHelp = () => {
  console.log(
    `
    usage: sslocal [-h] -s SERVER_ADDR -p SERVER_PORT [-b LOCAL_ADDR] -l LOCAL_PORT -k PASSWORD -m METHOD [-t TIMEOUT] [-c config]
                
    optional arguments:
      -h, --help            show this help message and exit
      -s SERVER_ADDR        server address
      -p SERVER_PORT        server port
      -b LOCAL_ADDR         local binding address, default is 127.0.0.1
      -l LOCAL_PORT         local port
      -k PASSWORD           password
      -m METHOD             encryption method, for example, aes-256-cfb
      -t TIMEOUT            timeout in seconds
      -c CONFIG             path to config file
    `
  );
};

const printServerHelp = () => {
  console.log(
    `
    usage: ssserver [-h] -s SERVER_ADDR -p SERVER_PORT -k PASSWORD -m METHOD [-t TIMEOUT] [-c config]
                
    optional arguments:
      -h, --help            show this help message and exit
      -s SERVER_ADDR        server address
      -p SERVER_PORT        server port
      -k PASSWORD           password
      -m METHOD             encryption method, for example, aes-256-cfb
      -t TIMEOUT            timeout in seconds
      -c CONFIG             path to config file
    `
  );
};

exports.parseArgs = (isServer = false) => {
  let defination = {
    '-l': 'local_port',
    '-p': 'server_port',
    '-s': 'server',
    '-k': 'password',
    '-c': 'config_file',
    '-m': 'method',
    '-b': 'local_address',
    '-t': 'timeout',
  };

  let result = {};
  let nextIsValue = false;
  let lastKey = null;
  for (let oneArg of process.argv.entries()) {
    if (nextIsValue) {
      result[lastKey] = oneArg;
      nextIsValue = false;
    } else if (oneArg in defination) {
      lastKey = defination[oneArg];
      nextIsValue = true;
    } else if (oneArg === '-v') {
      result['verbose'] = true;
    } else if (oneArg.indexOf('-') === 0) {
      if (isServer) {
        printServerHelp();
      } else {
        printLocalHelp();
      }
      process.exit(2);
    }
  }
  return result;
};

exports.checkConfig  = (config = {server: '', method: ''}) => {
  if (config.server === '127.0.0.1' || config.server === 'localhost') {
    exports.warn(`Server is set to ${config.server}, maybe it's not correct`);
    exports.warn(`Notice server will listen at ${config.server}:${config.server_port}`);
  }
  if (config.method.toLowerCase() === 'rc4') {
    return exports.warn('RC4 is not safe; please use a safer cipher, like AES-256-CFB');
  }
};

exports.version = `${pack.name} v${pack.version}`;
exports.EVERYTHING = 0;
exports.DEBUG = 1;
exports.INFO = 2;
exports.WARN = 3;
exports.ERROR = 4;

let _logging_level = exports.INFO;

exports.config = level => {
  _logging_level = level; 
}

exports.log = (level, msg) => {
  if (level >= _logging_level) {
    if (level >= exports.DEBUG) {
      util.log(`${new Date().getMilliseconds()}ms ${msg}`);
    } else {
      util.log(msg);
    }
  }
}

exports.debug = msg => {
  exports.log(exports.DEBUG, msg);
}

exports.info = msg => {
  exports.log(exports.INFO, msg);
}

exports.warn = msg => {
  exports.log(exports.WARN, msg);
}

exports.error = msg => {
  exports.log(exports.ERROR, msg ? msg.stack : msg);
}

exports.inetNtoa = buf => `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`

exports.inetAton = ipStr => {
  let parts = ipStr.split('.');
  if (!parts.length === 4) {
    return null;
  } else {
    let buf = new Buffer(4);
    let i = 0;
    while (i < 4) {
      buf[i] = +parts[i];
      i += 1;
    }
    return buf;
  }
}

setInterval(() => {
  if (_logging_level <= exports.DEBUG) {
    exports.debug(JSON.stringify(process.memoryUsage(), ' ', 2));
    if (global.gc) {
      exports.debug('GC');
      gc();
      exports.debug(JSON.stringify(process.memoryUsage(), ' ', 2));
      cwd = process.cwd();
      if (_logging_level === exports.DEBUG) {
        try {
          const heapdump = require('heapdump');
          process.chdir('/tmp');
          // heapdump.writeSnapshot();
          process.chdir(cwd);
        } catch (e) {
          exports.debug(e);
        }
      }
    }
  }
}, 1000);