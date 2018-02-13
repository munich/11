const popsicle = require('popsicle')
const goofy = require('app/core/goofy')
const PromiseWorker = require('app/core/promise-worker')
const Worker = require('tiny-worker')
const worker = new Worker(`${__dirname}/download-worker.js`)
const promiseWorker = new PromiseWorker(worker)

class Peer {
  constructor (ip, port, config) {
    this.ip = ip
    this.port = port
    this.ban = new Date().getTime()
    this.url = (port % 443 === 0 ? 'https://' : 'http://') + `${ip}:${port}`
    this.headers = {
      version: config.server.version,
      port: config.server.port,
      nethash: config.network.nethash
    }
  }

  toBroadcastInfo () {
    return {
      ip: this.ip,
      port: this.port,
      version: this.version,
      os: this.os,
      status: this.status,
      height: this.height,
      delay: this.delay
    }
  }

  get (api, timeout) {
    const temp = new Date().getTime()
    const that = this
    return popsicle
      .request({
        method: 'GET',
        url: this.url + api,
        headers: this.headers,
        timeout: timeout || 10000
      })
      .use(popsicle.plugins.parse('json'))
      .then(res => {
        that.delay = new Date().getTime() - temp
        return Promise.resolve(res)
      })
      .then(res => this.parseHeaders(res))
      .catch(error => (this.status = error.code))
      .then(res => Promise.resolve(res.body))
  }

  postBlock (block) {
    return popsicle
      .request({
        method: 'POST',
        url: this.url + '/peer/block/',
        data: block,
        headers: this.headers,
        timeout: 2000
      })
      .use(popsicle.plugins.parse('json'))
      .then(res => this.parseHeaders(res))
      .catch(error => (this.status = error.code))
      .then(res => Promise.resolve(res.body))
  }

  parseHeaders (res) {
    ['nethash', 'os', 'version', 'height'].forEach(key => (this[key] = res.headers[key]))
    this.status = 'OK'
    return Promise.resolve(res)
  }

  downloadBlocks (fromBlockHeight) {
    const message = {
      height: fromBlockHeight,
      headers: this.headers,
      url: this.url
    }
    const that = this
    return promiseWorker
      .postMessage(message)
      .then(response => {
        const size = response.body.blocks.length
        if (size === 100 || size === 400) that.downloadSize = size
        return Promise.resolve(response.body.blocks)
      }).catch(error => {
        goofy.debug('Cannot Download blocks from peer', error)
        that.ban = new Date().getTime() + 60 * 60000
      })
  }

  ping (delay) {
    return this
      .get('/peer/status', delay || 5000)
      .then(body => {
        if (body) return Promise.resolve(this.height = body.height)
        else throw new Error('Peer unreachable')
      })
  }

  getPeers () {
    return this
      .ping(2000)
      .then(() => this.get('/peer/list'))
      .then(body => body.peers)
  }
}

module.exports = Peer