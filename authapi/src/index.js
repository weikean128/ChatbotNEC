var app = require('express')()
var cors = require('cors')
const bodyParser = require('body-parser')

// cross-origin-header.. enable all cors requests
app.use(cors())
// parse application/json
app.use(bodyParser.json({ limit: '50mb' }))

// route to the specific version of api routes
app.use('/v1', require('./routes/v1/auth'))

app.listen(process.env.PORT, () => {
    console.log('listening in port: ' + process.env.PORT)
})