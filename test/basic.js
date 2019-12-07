var test = require('tape')
var level = require('level')
var ram = require('random-access-memory')
var multifeed = require('multifeed')
var Kappa = require('kappa-core')
var multifeedSource = require('kappa-core/sources/multifeed')
var collect = require('collect-stream')
var tmp = require('tmp')
var kv = require('..')

function makedb () {
  return level(tmp.dirSync().name)
}

test('id kv', function (t) {
  t.plan(13)

  var feeds = multifeed(ram, { valueEncoding: 'json' })
  var core = new Kappa()
  var source = multifeedSource({ feeds })
  var idx = makedb()

  var kvIdx = kv(idx, function (msg, next) {
    if (!msg.value.id) return next()
    var ops = []
    var msgId = msg.key + '@' + msg.seq
    ops.push({ key: msg.value.id, id: msgId, links: msg.value.links || [] })
    next(null, ops)
  })
  core.use('kv', source, kvIdx)

  feeds.writer('local', function (err, feed) {
    var docs = [
      { id: 'foo' },
      { id: 'foo', n: 3, links: [0] },
      { id: 'foo', n: 12, links: [0] }
    ]
    var versions = []
    var msgs = []
    ;(function next (i) {
      if (i >= docs.length) return check()

      docs[i].links = (docs[i].links || []).map(function (seq) {
        return version(feed, seq)
      })
      msgs.push(docs[i])
      feed.append(docs[i], function (err, seq) {
        t.error(err, 'append ok')
        versions.push(version(feed, seq))
        next(i+1)
      })
    })(0)

    function check () {
      core.view.kv.get('foo', function (err, values) {
        t.error(err, 'check ok')
        var expected = [
          {
            id: 'foo',
            n: 3,
            links: [ versions[0] ]
          },
          {
            id: 'foo',
            n: 12,
            links: [ versions[0] ]
          }
        ]
        t.deepEquals(values.map(v => v.value), expected, 'values match')

        collect(core.view.kv.createReadStream(), function (err, res) {
          t.error(err)
          res = res.map(m => { return { key: m.key, value: m.value.value } })
          t.deepEquals(res, [
            { key: 'foo', value: expected[0] },
            { key: 'foo', value: expected[1] }
          ])
        })
      })
    }

    var n = 0
    core.view.kv.onUpdateKey('foo', function (msg) {
      t.deepEquals(msg.value, msgs[n], 'update correct (value)')
      t.equals(msg.seq, n, 'update correct (seq)')
      n++
    })
  })
})

test('id ca', function (t) {
  t.plan(8)

  var feeds = multifeed(ram, { valueEncoding: 'json' })
  var core = new Kappa()
  var source = multifeedSource({ feeds })
  var idx = makedb()

  var sha = require('sha.js')
  var caIdx = kv(idx, function (msg, next) {
    var ops = []
    var hash = sha('sha256').update(JSON.stringify(msg.value)).digest('hex')
    var msgId = msg.key + '@' + msg.seq
    ops.push({ key: hash, id: msgId, links: [] })
    next(null, ops)
  })
  core.use('ca', source, caIdx)

  feeds.writer('local', function (err, feed) {
    var docs = [
      { id: 'foo', y: -1 },
      { id: 'bax', n: 1 },
      { id: 'bur', x: 213 },
    ]
    var expectedHashes = [
      '8e09a0313464c6b5d57c0e0948d316c94b66f6e02873798d68d5411c84f0303d',
      '6bb253dcd04354f71fac02a1a0b0ab68b94e24e3fdb3ed145ff16aa4eec8f98a',
      'e2c1616a09805ae08a578f5a949294cb6f701e68eeb7cb0c0baaac50432150a3'

    ]
    var versions = []
    var msgs = []

    ;(function next (i) {
      if (i >= docs.length) return check()

      if (docs[i].links) {
        docs[i].links = (docs[i].links || []).map(function (seq) {
          return version(feed, seq)
        })
      }
      msgs.push(docs[i])
      feed.append(docs[i], function (err, seq) {
        t.error(err, 'append ok')
        versions.push(version(feed, seq))
        next(i+1)
      })
    })(0)

    function check () {
      core.view.ca.get('6bb253dcd04354f71fac02a1a0b0ab68b94e24e3fdb3ed145ff16aa4eec8f98a', function (err, values) {
        t.error(err, 'check ok')
        var expected = [ { id: 'bax', n: 1 } ]
        values = values.map(v => v.value)
        t.deepEquals(values, expected, 'values match')
      })
    }

    core.view.ca.onUpdateKey('8e09a0313464c6b5d57c0e0948d316c94b66f6e02873798d68d5411c84f0303d', function (msg) {
      t.deepEquals(msg.value, msgs[0], 'update correct (value)')
      t.equals(msg.seq, 0, 'update correct (seq)')
      var hash = sha('sha256').update(JSON.stringify(msg.value)).digest('hex')
      t.equals(hash, expectedHashes[0], 'update correct (hash)')
    })
  })
})

function version (feed, seq) {
  return feed.key.toString('hex') + '@' + seq
}
