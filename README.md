# kappa-view-kv

> General purpose multi-value key/value view for [kappa-core][kappa-core]

Models a key/value store, except each key can map to multiple values. This is
necessary, since multiple users could write an edit to a key at the same time,
while offline, and then sync with each other at a later time. A subsequent
write to that key would overwrite both, causing there to be one value for that
key again. This is done so that each application can choose what kind of
conflict resolution scheme works best for it.

## Usage

Let's build a key-value view that maps the 'id' field to the latest values of
that id.

```js
var memdb = require('memdb')
var kappa = require('kappa-core')
var kv = require('.')

// initialize kappa-core (on disk storage ("db") + in-memory views (memdb))
var core = kappa('./db', { valueEncoding: 'json' })
var idx = memdb()

// create the key-value view
var kvIdx = kv(idx, function (msg, next) {
  if (!msg.value.id) return next()
  var ops = []
  var msgId = msg.key + '@' + msg.seq

  // key  : the 'key' part of the key-value store
  // id   : the identifier that the key maps to (the "FEED@SEQ" uniquely maps to this message)
  // links: a list of IDs ^ that this key replaces
  ops.push({ key: msg.value.id, id: msgId, links: msg.value.links || [] })

  next(null, ops)
})

// install key-value view into kappa-core under core.api.kv
core.use('kv', kvIdx)

// create a new writable feed & write some documents
core.feed('local', function (err, feed) {
  // for each of these, the key 'foo' maps to each message
  var docs = [
    { id: 'foo' },
    { id: 'foo', n: 3, links: [] },
    { id: 'foo', n: 12, links: [] }
  ]

  feed.append(docs[0], function (err, seq) {
    // 2nd doc links to the 1st, replacing it
    docs[1].links.push(version(feed, seq))
    feed.append(docs[1], function () {

      // 3rd doc also links to the 1st
      docs[2].links.push(version(feed, seq))
      feed.append(docs[2], function () {

        core.api.kv.get('foo', function (err, values) {
          console.log('kv for "foo"', values)
        })
      })
    })
  })

  // listen for updates to a particular key
  core.api.kv.onUpdateKey('foo', function (msg) {
    console.log('update', msg.seq)
  })
})

function version (feed, seq) {
  return feed.key.toString('hex') + '@' + seq
}
```

outputs

```
update 0
update 1
update 2
kv for "foo" [ { key: '572f824672f0a14ccc45851a04e249506ac234e2e6a9efeac55bfbe4987b9241',
    seq: 1,
    value: { id: 'foo', n: 3, links: ['0f4950f4bbf17dab676e10ce45cc6539e189398b5ce84926c5b60a0826aaecfb@0'] } },
  { key: '572f824672f0a14ccc45851a04e249506ac234e2e6a9efeac55bfbe4987b9241',
    seq: 2,
    value: { id: 'foo', n: 12, links: ['0f4950f4bbf17dab676e10ce45cc6539e189398b5ce84926c5b60a0826aaecfb@0'] } } ]
```

There are two entries for `'foo'` because both *linked* to the 1st entry, thus
replacing it. That's also why they both *link* to the 1st message.

## API

```js
var kv = require('kappa-view-kv')
```

### var view = kv(lvl, mapFn)

Creates a new kappa view, `view`, using the LevelUP/LevelDOWN storage `lvl` and
a mapping function `mapFn`.

Here's how `mapFn` works:

```js
function mapMsgToKvEntry (msg, next) {
  var ops = [
    {
      key: msg.value.id,
      id: msg.key + '@' + msg.seq,
      links: msg.value.links
    }
  ]
  next(null, ops)
}
```

`ops` is a list of key-value *op*erations to add to the index. One message
might update multiple key-value pairs (like mapping ID -> msg and also
ContentHash -> msg). Each op is an object with fields

- `key` (string): the "key" part of the key-value store; what is being mapped to values
- `id` (string): some string that uniquely identifies this particular entry
- `links` (array(string)): a list of IDs (like the above) that indicates what older entries for this key that it replaces

The callback `next` is called as `next(error?, ops)`.

From here, you can use `core.use(name, view)` to install it into a
[kappa-core][kappa-core]. What follows are the APIs that get exposed if you did
`core.use('kv', view)`:

### core.kv.get(key, cb)

Fetch the latest values for a key. cb is called as `cb(err, values)`. `values`
is an array, since there may be multiple values mapped to by a key at any given
point.

### var rs = core.kv.createReadStream()

Returns a readable stream of all keys and their latest `values` mappings.

### core.kv.onUpdate(fn)

Subscribe to updates to every key change. The function `fn` is called as `fn(key, value)`.

### core.kv.onUpdateKey(key, fn)

Subscribe to updates to a specific key. The function `fn` is called as `fn(value)`.

## Install

With [npm](https://npmjs.org/) installed, run

```
$ npm install kappa-view-kv
```

## License

ISC

[kappa-core]: https://github.com/noffle/kappa-core

