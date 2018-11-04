var memdb = require('memdb')
var kappa = require('kappa-core')
var kv = require('.')

var core = kappa('./db', { valueEncoding: 'json' })
var idx = memdb()

var kvIdx = kv(idx, function (msg, next) {
  if (!msg.value.id) return next()
  var ops = []
  var msgId = msg.key + '@' + msg.seq
  ops.push({ key: msg.value.id, id: msgId, links: msg.value.links || [] })
  next(null, ops)
})
core.use('kv', kvIdx)

core.feed('local', function (err, feed) {
  var docs = [
    { id: 'foo' },
    { id: 'foo', n: 3, links: [] },
    { id: 'foo', n: 12, links: [] }
  ]
  feed.append(docs[0], function (err, seq) {
    docs[1].links.push(version(feed, seq))
    feed.append(docs[1], function () {
      docs[2].links.push(version(feed, seq))
      feed.append(docs[2], function () {
        core.api.kv.get('foo', function (err, values) {
          console.log('values', values)
        })
      })
    })
  })

  core.api.kv.onUpdateKey('foo', function (msg) {
    console.log('update', msg)
  })
})

function version (feed, seq) {
  return feed.key.toString('hex') + '@' + seq
}
