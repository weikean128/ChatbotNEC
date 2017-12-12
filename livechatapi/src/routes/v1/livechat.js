const router = require('express').Router()
var jwt = require('jsonwebtoken') // sign with default (HMAC SHA256)
const { check, validationResult } = require('express-validator/check')
const { matchedData, sanitize } = require('express-validator/filter')
const uuidv4 = require('uuid/v4')
const bs58 = require('bs58')

// temp only.. remove it in production
/*process.env.MASQL_HOST = 'localhost'
process.env.MYSQL_DATABASE = 'NECAIDB'
process.env.MYSQL_USER = 'necaidbuser'
process.env.MYSQL_PASSWORD = 'NECAIDBuser20171020'
process.env.jwtSecret = 'soseCREToMg8228'
*/

var { Database } = require('../../database')

// create new live chat for this user
var createNewLivechat = (user_submit) => {

    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'SELECT plan_id FROM users_plans WHERE user_id=?',
                'SELECT * FROM plans WHERE id=?',
                'SELECT * FROM livechat WHERE createdby=?',
                'INSERT INTO livechat (uuid, createdby, name, description) VALUES (?, ?, ?, ?)'
            ]

            // all possible errors
            const db_errors = [
                'cannot find user plan id',
                'cannot find the plan detail',
                'livechat project exceed limit'
            ]

            // do things in parallel
            let all_results = await Promise.all([
                new Promise(async (resolve, reject) => {
                    // find out the user current plans

                    let user_planid = ''

                    {
                        // find the plan id
                        let row_plan_id = await database.query(sql_queries[0], [user_submit.user_id])
                        user_planid = row_plan_id[0]
                    }

                    if (!user_planid) {
                        reject(db_errors[0])
                    }

                    let plan_info = ''

                    {
                        let row_plan_info = await database.query(sql_queries[1], [user_planid.plan_id])
                        plan_info = row_plan_info[0]
                    }

                    if (!plan_info) {
                        reject(db_errors[1])
                    }

                    // return the user signed up plan info
                    resolve(plan_info)
                }),
                new Promise(async (resolve, reject) => {
                    // find all projects created by this user
                    let row_livechats = await database.query(sql_queries[2], [user_submit.user_id])
                    resolve(row_livechats)
                })
            ])

            let plan_info = all_results[0]
            let all_livechats = all_results[1]

            if (all_livechats.length >= plan_info.livechat_limit) {
                throw db_errors[2]
            }

            // create the new live chat
            let row_insert_livechat = await database.query(sql_queries[3], [user_submit.uuid, user_submit.user_id, user_submit.name, user_submit.description])
            resolve(row_insert_livechat.insertId)

        }
        catch (e) {
            // reject the error
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()

    })

}

// every api router will go through JWT verification first
router.use(
    [
        check('token', 'must have a token').exists()
    ],
    (req, res, next) => {

        // checking the results
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            // if request datas is incomplete or error, return error msg
            return res.status(422).json({ success: false, errors: errors.mapped() });
        }
        else {

            // get the matched data
            // get the jwt token from body
            let token = matchedData(req).token;

            jwt.verify(token, process.env.jwtSecret, (err, decoded) => {
                if (err) {
                    return res.json({ success: false, errors: { jwt: 'json web token validate error' } });
                }
                else {

                    // Officially trusted this client!
                    req.decoded = decoded;
                    next();
                }
            });
        }

    }
)

// create a new live chat
router.post(
    '/',
    [
        check('name', 'must have a name for this livechat project').exists().isLength({ min: 1 }),
        check('description', 'must have a description for this live chat').exists().isLength({ min: 1 })
    ],
    (req, res) => {
        // checking the results
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            // if request datas is incomplete or error, return error msg
            return res.status(422).json({ success: false, errors: errors.mapped() });
        }
        else {

            let userid = req.decoded.data.i
            let name = matchedData(req).name
            let description = matchedData(req).description
            // base 58 encode it
            let public_uuid = bs58.encode(Buffer.from(uuidv4()))

            createNewLivechat({ user_id: userid, name: name, description: description, uuid: public_uuid }).then((result)=>{

                // send the result back to client
                res.setHeader('Content-type', 'application/json')
                res.send(JSON.stringify({ success: true }))

            }).catch((error) => {
                return res.status(422).json({ success: false, errors: error })
            })

        }
    }
)

module.exports = router
