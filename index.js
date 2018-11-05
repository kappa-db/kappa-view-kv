var umkv = require('unordered-materialized-kv')
var EventEmitter = require('events').EventEmitter
var through = require('through2')

module.exports = KV

function KV (db, mapFn, opts) {
  var kv = umkv(db)
  var events = new EventEmitter()
  opts = opts || {}

  var idx = {
    maxBatch: opts.maxBatch || 100,

    map: function (msgs, next) {
      var allOps = []
      var pending = msgs.length + 1
      for (var i = 0; i < msgs.length; i++) {
        var msg = msgs[i]
        mapFn(msg, function (err, ops) {
          if (!ops) ops = []
          done(err, ops, msg)
        })
      }
      done(null, [])

      function done (err, ops, msg) {
        if (err) {
          pending = Infinity
          return next(err)
        }
        allOps.push.apply(allOps, ops)
        if (!--pending) kv.batch(allOps, next)
      }
    },

    indexed: function (msgs) {
      for (var i = 0; i < msgs.length; i++) {
        mapFn(msgs[i], function (err, ops) {
          if (err || !ops || !ops.length) return
          events.emit('update!' + ops[0].key, msgs[i])
          events.emit('update', ops[0].key, msgs[i])
        })
      }
    },

    api: {
      get: function (core, key, cb) {
        this.ready(function () {
          kv.get(key, function (err, ids) {
            if (err) return cb(err)
            var res = []
            var pending = ids.length + 1
            for (var i = 0; i < ids.length; i++) {
              var id = ids[i]
              // XXX: this assumes KEY@SEQ format!!! userspace might not do
              // this!
              // TODO: expose this on kappa-core somehow
              // TODO: in fact, can we just expose the 'version' string /w @
              // explicitly?
              var feed = core._logs.feed(id.split('@')[0])
              var seq = Number(id.split('@')[1])
              ;(function (feed, seq) {
                feed.get(seq, function (err, value) {
                  if (err) return done(err)
                  done(null, {
                    key: feed.key.toString('hex'),
                    seq: seq,
                    value: value
                  })
                })
              })(feed, seq)
            }
            done()

            function done (err, msg) {
              if (err) {
                pending = Infinity
                return cb(err)
              }
              if (msg) res.push(msg)
              if (!--pending) cb(null, res)
            }
          })
        })
      },

      createReadStream: function (core) {
        var t = through.obj(function (entry, _, next) {
          var self = this
          var pending = 1
          var res = entry.value.split(',').forEach(function (value) {
            pending++
            var feed = core._logs.feed(value.split('@')[0])
            if (feed) {
              var seq = Number(value.split('@')[1])
              feed.get(seq, function (err, val) {
                if (!err) {
                  self.push({
                    key: entry.key.substring(2),
                    value: {
                      key: feed.key.toString('hex'),
                      seq: seq,
                      value: val
                    }
                  })
                }
                done()
              })
            }
          })
          done()

          function done () {
            if (!--pending) next()
          }
        })
        db.createReadStream({gt: 'k!!', lt: 'k!~'}).pipe(t)
        return t
      },

      onUpdateKey: function (core, key, cb) {
        events.on('update!' + key, cb)
      },

      onUpdate: function (core, cb) {
        events.on('update', cb)
      }
    },

    storeState: function (state, cb) {
      db.put('state', state, cb)
    },

    fetchState: function (cb) {
      db.get('state', function (err, state) {
        if (err && err.notFound) cb()
        else if (err) cb(err)
        else cb(null, state)
      })
    },
  }
  return idx
}

