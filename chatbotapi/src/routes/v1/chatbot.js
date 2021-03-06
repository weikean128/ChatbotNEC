const router = require('express').Router()
var jwt = require('jsonwebtoken') // sign with default (HMAC SHA256)
const { check, validationResult } = require('express-validator/check')
const { matchedData, sanitize } = require('express-validator/filter')
const uuidv4 = require('uuid/v4')
const bs58 = require('bs58')
const MongoClient = require('mongodb').MongoClient
const request = require('superagent')
var fs = require('fs')

// temp only.. remove it in production
/*process.env.MASQL_HOST = 'localhost'
process.env.MAMONGO_HOST = 'localhost'
process.env.MYSQL_DATABASE = 'NECAIDB'
process.env.MYSQL_USER = 'necaidbuser'
process.env.MYSQL_PASSWORD = 'NECAIDBuser20171020'
process.env.jwtSecret = 'soseCREToMg8228'*/

var { Database } = require('../../database')

// MongoDB Connection URL
const url = 'mongodb://' + process.env.MAMONGO_HOST

// generate a uuid for chatbot
var getUUID = () => {
  return bs58.encode(Buffer.from(uuidv4()))
}

// create new live chat for this user
var createNewChatbot = (user_submit) => {
  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()

    try {
      // all necessary sql queries
      const sql_queries = [
        'SELECT plan_id FROM users_plans WHERE user_id=?',
        'SELECT * FROM plans WHERE id=?',
        'SELECT * FROM chatbot WHERE createdby=?',
        'INSERT INTO chatbot (uuid, createdby, name, description) VALUES (?, ?, ?, ?)'
      ]

      // all possible errors
      const db_errors = [
        'cannot find user plan id',
        'cannot find the plan detail',
        'chatbot project exceed limit'
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
      let all_chatbots = all_results[1]

      if (all_chatbots.length >= plan_info.chatbot_limit) {
        throw db_errors[2]
      }

      // create the new chatbot
      let row_insert_chatbot = await database.query(sql_queries[3], [user_submit.uuid, user_submit.user_id, user_submit.name, user_submit.description])
      resolve(row_insert_chatbot.insertId)

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

  })
}

// delete a live chat for this user
var deleteChatbotProject = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()
    let client = ''

    try {
      // connect to my mongodb first
      client = await MongoClient.connect(url)

      // all necessary sql queries
      const sql_queries = [
        'DELETE FROM chatbot WHERE uuid=?'
      ]

      // all possible errors
      const db_errors = [
        'no such chatbot project'
      ]

      let all_results = await Promise.all([
        new Promise(async (resolve, reject) => {

          // delete this chatbot project from mysql
          let row_deletechatbot = await database.query(sql_queries[0], [chatbot_uuid])
          if (!row_deletechatbot.affectedRows) {
            reject(db_errors[0])
          }
          resolve(row_deletechatbot)

        }),
        new Promise(async (resolve, reject) => {

          // delete from mongodb also
          const db = client.db(process.env.MYSQL_DATABASE)
          const collection = db.collection('chatbot_ml_datas')
          let mongo_deletedocument = await collection.deleteOne({ uuid: chatbot_uuid })
          resolve(mongo_deletedocument.result)

        }),
        request
          .post('coreengine/deleteProject')
          .set('contentType', 'application/json; charset=utf-8')
          .set('dataType', 'json')
          .send({
            projectName: chatbot_uuid
          })
      ])

      resolve()

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

    // rmb to close my mongodb collection
    client.close()

  })
}

// refresh live chat project uuid
var updateIntentHit = (chatbot_uuid, intentname) => {
  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()

    try {
      // all necessary sql queries
      const sql_queries = [
        'UPDATE intents_hits SET hits=hits+1 WHERE uuid=? AND intentName=?',
        'INSERT INTO intents_hits (uuid, intentName, hits) VALUES (?, ?, 1)'
      ]

      // all possible errors
      const db_errors = [
        'no such chatbot project'
      ]

      // update the intent hit
      const row_updatehit = await database.query(sql_queries[0], [chatbot_uuid, intentname])

      if (!row_updatehit.affectedRows) {
        // if this is the new entry
        const inserthit = await database.query(sql_queries[1], [chatbot_uuid, intentname])
      }

      // if update finish
      resolve()

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

  })
}

// refresh live chat project uuid
var refreshChatbotUUID = (chatbot_uuid) => {

  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()

    try {
      // all necessary sql queries
      const sql_queries = [
        'UPDATE chatbot SET uuid=? WHERE uuid=?'
      ]

      // all possible errors
      const db_errors = [
        'no such chatbot project'
      ]

      // delete this intent
      let row_updateuuid = await database.query(sql_queries[0], [getUUID(), chatbot_uuid])

      if (!row_updateuuid.affectedRows) {
        throw db_errors[0]
      }

      resolve()

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

  })

}

// get the chatbot info based on this uuid
var getChatbotInfo = (chatbot_uuid) => {

  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()

    try {
      // all necessary sql queries
      const sql_queries = [
        'SELECT * FROM chatbot WHERE uuid=?'
      ]

      // all possible errors
      const db_errors = [
        'no such chatbot project'
      ]

      // get this chatbot
      let row_chatbot = await database.query(sql_queries[0], [chatbot_uuid])

      if (row_chatbot.length <= 0) {
        throw db_errors[0]
      }

      resolve(row_chatbot)

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

  })

}

// get the live chat info based on this uuid
var getChatbotsInfo = (user_id) => {

  return new Promise(async (resolve, reject) => {

    // connect to mariadb/mysql
    let database = new Database()

    try {
      // all necessary sql queries
      const sql_queries = [
        'SELECT * FROM chatbot WHERE createdby=?'
      ]

      // all possible errors
      const db_errors = [
        'no such chatbot project'
      ]

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], [user_id])

      if (row_chatbots.length <= 0) {
        throw db_errors[0]
      }

      resolve(row_chatbots)

    }
    catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close the db
    let dbclose = await database.close()

  })

}

var getCBDatasFromChatbot = (chatbot_uuid) => {

  return new Promise(async (resolve, reject) => {

    let client = ''

    try {
      // connect to my mongodb
      client = await MongoClient.connect(url)

      // connect to my db
      const db = client.db(process.env.MYSQL_DATABASE)

      // Get the collection from my db
      const collection = db.collection('chatbot_ml_datas')

      // find all documents
      let findall = await collection.find({ 'uuid': chatbot_uuid }).toArray()

      if (findall.length > 0) {
        resolve(findall[0])
      }

      throw 'no such nlu_data, are u sure this is the right chatbot uuid?'

    } catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close my mongodb collection
    client.close()
  })

}

var retrieveAllCBDatasFromCB = async (chatbot_uuid) => {
  // get the cbdatas from this cb first
  const cbdatas = await getCBDatasFromChatbot(chatbot_uuid)

  if (cbdatas.combinedprojs.length > 0) {

    let combineddatas = {...cbdatas}
    let allcbqueries = []

    // need to combined with other projects
    cbdatas.combinedprojs.forEach((extraprojuuid)=>{
      allcbqueries.push(new Promise(async (resolve, reject)=>{
        const otherdatas = await getCBDatasFromChatbot(extraprojuuid)
        resolve(otherdatas)
      }))
    })

    // query all of them at the same time
    let allquerieddatas = await Promise.all(allcbqueries)

    // then combined them tgt
    allquerieddatas.forEach((querydatas)=>{
      combineddatas.entities.push(...querydatas.entities)
      combineddatas.intents.push(...querydatas.intents)
      combineddatas.actions.push(...querydatas.actions)
      combineddatas.stories.push(...querydatas.stories)
    })

    return combineddatas
  }

  // 1) if no need, then return the initial cbdatas
  return cbdatas

  // 2) if need, retrieve other cbdatas and combined it tgt, then return it for training 
}

var getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
}

var expressValidateFirst = (req, res, cb) => {
  // checking the results
  const errors = validationResult(req)

  if (!errors.isEmpty()) {
    // if request datas is incomplete or error, return error msg
    return res.status(422).json({ success: false, errors: errors.mapped() })
  }
  else {
    cb()
  }
}

// chatbot query message
router.post(
  '/query',
  [
    check('text_message', 'text_message for the chatbot query is missing').exists().isLength({ min: 1 }),
    check('uuid', 'chatbot uuid for the chatbot query is missing').exists().isLength({ min: 1 }),
    check('sender_id', 'sender_id for the chatbot query is missing').exists().isLength({ min: 1 })
  ],
  async (req, res) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      let projectName = matchedData(req).uuid
      let text_message = matchedData(req).text_message
      let sender_id = matchedData(req).sender_id

      try {
        // query to chatbot and start the conversation
        let startmsg = await request
          .post('coreengine/startmsg')
          .set('contentType', 'application/json; charset=utf-8')
          .set('dataType', 'json')
          .send({
            projectName: projectName,
            text_message: text_message,
            sender_id: sender_id
          })

        let daresult = await getCBDatasFromChatbot(projectName)

        const cbtracker = JSON.parse(startmsg.text)

        if (sender_id.search("admin:") < 0) {
          // if is client sent this msg, then update the intent hit counts
          const hitIntent = cbtracker.tracker.latest_message.intent.name
          // store/update the intent name that the User hit
          await updateIntentHit(projectName, hitIntent)
        }

        // return the query result back
        res.json({ ...cbtracker, initialResponse: daresult.initialResponse })

      } catch (error) {
        res.json({ error: error.toString() })
      }
    }

  }
)

router.post(
  '/executeAction',
  [
    check('action', 'executed_action for the chatbot query is missing').exists().isLength({ min: 1 }),
    check('uuid', 'chatbot uuid for the chatbot query is missing').exists().isLength({ min: 1 }),
    check('sender_id', 'sender_id for the chatbot query is missing').exists().isLength({ min: 1 })
  ],
  async (req, res) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      const projectName = matchedData(req).uuid
      const useraction = matchedData(req).action
      const sender_id = matchedData(req).sender_id

      try {

        const workparallels = await Promise.all([

          new Promise(async (resolve, reject) => {
            try {
              const cbdatas = await retrieveAllCBDatasFromCB(projectName)
              const cbactions = cbdatas.actions

              for (let i = 0; i < cbactions.length; ++i) {
                if (cbactions[i].name === useraction) {
                  // randomly choose one of it pls..
                  const allactions = cbactions[i].allActions
                  resolve(allactions[getRandomInt(allactions.length)])
                  break
                }
              }
            }
            catch (e) {
              reject(e.toString())
            }
          }),

          // tell my engine that i have executed the action
          request
            .post('coreengine/executedAct')
            .set('contentType', 'application/json; charset=utf-8')
            .set('dataType', 'json')
            .send({
              projectName: projectName,
              executed_action: useraction,
              sender_id: sender_id
            })

        ])

        // see whether got any fulfillment link or not
        const returnAct = workparallels[0]
        returnAct.forEach((eachact)=>{
          switch (eachact.type) {
            case 'WH':
              // call webhook here and wait for it to return
              console.log(returnAct)
              break
          
            default:
              break
          }
        })

        // successfully executed the action, return the necessary data back
        res.json({ returnAct: returnAct, result: JSON.parse(workparallels[1].text) })

      }
      catch (error) {
        res.json({ error: error.toString() })
      }

    }

  }
)

// every api router will go through JWT verification first
router.use(
  [
    check('token', 'must have a token').exists()
  ],
  (req, res, next) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {

      // get the matched data
      // get the jwt token from body
      let token = matchedData(req).token

      jwt.verify(token, process.env.jwtSecret, (err, decoded) => {
        if (err) {
          return res.json({ success: false, errors: { jwt: 'json web token validate error' } })
        }
        else {

          // Officially trusted this client!
          req.decoded = decoded
          next()
        }
      })
    }

  }
)

// create a new chatbot project
router.post(
  '/',
  [
    check('name', 'must have a name for this chatbot project').exists().isLength({ min: 1 }),
    check('description', 'must have a description for this chatbot').exists().isLength({ min: 1 })
  ],
  (req, res) => {
    expressValidateFirst(req, res, ()=>{

      // base 58 encode it
      let public_uuid = getUUID()

      createNewChatbot({
        user_id: req.decoded.data.i,
        name: matchedData(req).name,
        description: matchedData(req).description,
        uuid: public_uuid
      }).then((result) => {

        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ success: true }))

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })

    })
  }
)

// delete this a chabot project
router.delete(
  '/',
  [
    check('uuid', 'uuid for the chatbot project is missing').exists().isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {

      deleteChatbotProject(matchedData(req).uuid).then(() => {
        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ success: true }))
      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })

    })
  }
)

// refresh chatbot uuid
router.post(
  '/refreshUUID',
  [
    check('uuid', 'uuid for the chatbot project is missing').exists().isLength({ min: 1 }),
  ],
  (req, res) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      refreshChatbotUUID(matchedData(req).uuid).then(() => {

        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ success: true }))

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })
    }

  }
)

// get a specific chatbot project info for this user
router.get(
  '/info',
  [
    check('uuid', 'uuid for the chatbot project is missing').exists().isLength({ min: 1 })
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      getChatbotInfo(matchedData(req).uuid).then((result) => {

        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ success: true, result: result }))

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })
    }
  }
)

// get all the chatbot projects infos for this user
router.get('/infos', (req, res) => {
    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      getChatbotsInfo(req.decoded.data.i).then((results) => {

        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ success: true, result: results }))

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })
    }
})

var updateCBDatasForChatbot = (chatbot_uuid, cbdatas) => {
  return new Promise(async (resolve, reject) => {

    let client = ''

    try {
      // connect to my mongodb
      client = await MongoClient.connect(url)

      // connect to my db
      const db = client.db(process.env.MYSQL_DATABASE)

      // Get the collection from my db
      const collection = db.collection('chatbot_ml_datas')

      // Update the document with an atomic operator
      let update_chatbot = await collection.updateOne({ uuid: chatbot_uuid }, { $set: { entities: cbdatas.entities, intents: cbdatas.intents, actions: cbdatas.actions, stories: cbdatas.stories, combinedprojs: cbdatas.combinedprojs, initialResponse: cbdatas.initialResponse } }, { upsert: true, w: 1 })

      if (!update_chatbot.result.n) {
        throw 'no such cb datas for this cb'
      }
      resolve(update_chatbot.result)

    } catch (e) {
      // reject the error
      reject(e.toString())
    }

    // rmb to close my mongodb collection
    client.close()
  })
}

var convertToNluDataFormat = (intents, entities) => {

  let rasa_nlu_data = {
    common_examples: [],
    entity_synonyms: [],
    regex_features: []
  }

  // preparing entity_synonyms
  entities.forEach((entity, index) => {
    entity.values.map((values, vindex) => {
      rasa_nlu_data.entity_synonyms.push(
        {
          value: values.name,
          synonyms: [...values.synonyms]
        }
      )
    })
  })

  // preparing common_examples
  intents.forEach((intent) => {
    const entitiesToSearch = intent.entities

    intent.texts.map((text) => {

      let entitiesIn = []

      // find the entities in the text
      entitiesToSearch.forEach((entityToSearch, eindex) => {
        entities.forEach((mainEntity, mindex) => {
          if (entityToSearch === mainEntity.name) {
            mainEntity.values.forEach((mainValue, mvindex) => {

              let rvalue = mainValue.name

              // first see the value name got match in the text or not
              let start = text.indexOf(rvalue)
              let end = 0

              if (start >= 0) {
                // match the name..
                end = start + rvalue.length
                entitiesIn.push({ start: start, end: end, value: rvalue, entity: entityToSearch })
              }
              else {
                // check for synonyms
                const sns = mainValue.synonyms
                sns.forEach((sn) => {
                  let start = text.indexOf(sn)
                  if (start >= 0) {
                    let end = start + sn.length
                    entitiesIn.push({ start: start, end: end, value: rvalue, entity: entityToSearch })
                  }
                })
              }

            })
          }
        })
      })

      rasa_nlu_data.common_examples.push({
        text: text,
        intent: intent.intent,
        entities: entitiesIn
      })

    })

  })

  return rasa_nlu_data
}

var traincb = (cbuuid) => {
  return new Promise(async (resolve, reject) => {

    try {
      // when posted new data, train it straight away
      // get the nlu data first
      let cbdatas = await retrieveAllCBDatasFromCB(cbuuid)

      // prepare the domain
      let domain = {
        intents: [],
        actions: [],
        entities: [],
        /*slots: {
            city: { type: 'categorical', values: ['New York City', 'Manhatten City'] }
        },*/
        action_factory: 'remote',
        config: { store_entities_as_slots: true }
      }

      domain.intents = cbdatas.intents.map((intent) => {
        return intent.intent
      })

      domain.actions = cbdatas.actions.map((action) => {
        return action.name
      })

      domain.entities = cbdatas.entities.map((entity) => {
        return entity.name
      })

      let storiesmdstr = ''
      cbdatas.stories.forEach((story) => {
        storiesmdstr += '## ' + story.name + '\n'

        if (story.wait_checkpoint) {
          storiesmdstr += '> ' + story.wait_checkpoint + '\n'
        }

        let intentconditionsstr = ''
        if (story.intentConditions.length > 0) {
          intentconditionsstr = '{'
          story.intentConditions.forEach((intentCondition) => {
            intentconditionsstr += '"' + intentCondition.entity + '" = "' + intentCondition.value + '",'
          })
          // remove the last comma
          intentconditionsstr = intentconditionsstr.slice(0, -1)
          intentconditionsstr += '}'
        }

        storiesmdstr += '* ' + story.intent + '\n'
        story.actions.forEach((action) => {
          storiesmdstr += '  - ' + action + '\n'
        })

        if (story.return_checkpoint) {
          storiesmdstr += '> ' + story.return_checkpoint + '\n'
        }

        storiesmdstr += '\n'
      })

      // train the nlu first
      let nlutrainning = await request
        .post('nluengine:5000/train?project=' + cbuuid + '&fixed_model_name=model&pipeline=spacy_sklearn')
        .set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
        .send({
          rasa_nlu_data: convertToNluDataFormat(cbdatas.intents, cbdatas.entities)
        })

      // train the dialogues later
      let dialoguetrainning = await request
        .post('coreengine/training')
        .set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
        .send({
          projectName: cbuuid,
          domain: domain,
          stories: storiesmdstr
        })

      resolve({ dialogueTraining: dialoguetrainning.body, nluTraining: nlutrainning.body })

    } catch (e) {
      // reject the error
      reject(e.toString())
    }

  })
}

// the rest of the api need chatbot uuid in order to do things
router.use(
  [
    check('uuid', 'must have a chatbot uuid').exists()
  ],
  (req, res, next) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {

      // get the matched data
      // get the uuid from body
      let uuid = matchedData(req).uuid

      getChatbotInfo(uuid).then((result) => {

        // Officially got the uuid
        req.chatbot_info = result[0]
        next()

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })

    }

  }
)

// get the chatbot datas from this chatbot
router.get('/CBDatas', (req, res) => {

  getCBDatasFromChatbot(req.chatbot_info.uuid).then((result) => {
    res.json({ success: true, result: result })
  }).catch((error) => {
    return res.status(422).json({ success: false, errors: error })
  })

})

// post entities, intents, actions and stories cb datas and store it in my mongodb
// and then train the chatbot
router.post(
  '/CBDatas',
  [
    check('cbdatas', 'cbdatas for the chatbot project is missing').exists().isLength({ min: 1 })
  ],
  (req, res) => {
    expressValidateFirst(req, res, ()=>{

      // get the cb uuid first
      let cbuuid = req.chatbot_info.uuid

      updateCBDatasForChatbot(
        cbuuid,
        matchedData(req).cbdatas
      ).then((result) => {

        // after updating the datas.. train the chatbot straight away
        traincb(cbuuid).then((result) => {
          res.json(result)
        }).catch((error) => {
          return res.status(422).json({ success: false, errors: error })
        })

      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })

    })
  }
)

// just save the cbdatas only
router.put(
  '/CBDatas',
  [
    check('cbdatas', 'cbdatas for the chatbot project is missing').exists().isLength({ min: 1 })
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {

      // get the cb uuid first
      let cbuuid = req.chatbot_info.uuid

      updateCBDatasForChatbot(
        cbuuid,
        matchedData(req).cbdatas
      ).then((result) => {
        res.json(result)
      }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })

    })
  }
)

// train my dialogue using nlu_data
router.post('/cbtraining', (req, res) => {

  traincb(req.chatbot_info.uuid).then((result) => {
    res.json(result)
  }).catch((error) => {
    return res.status(422).json({ success: false, errors: error })
  })

})

// chatbot query message
router.post(
  '/nlucheck',
  [
    check('text_message', 'text_message for the chatbot query is missing').exists().isLength({ min: 1 })
  ],
  (req, res) => {

    // checking the results
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() })
    }
    else {
      request
        .get('nluengine:5000/parse')
        .query({ q: matchedData(req).text_message, project: req.chatbot_info.uuid, model: 'model' })
        .end((err, res2) => {
          if (err) {
            res.json({ err: err.toString() })
          }
          let allcbres = res2.body
          res.json({ allres: allcbres })
        })
    }

  }
)

// dialogue training status
router.post('/nlustatus', (req, res) => {
  // ask for nlu training status
  request
    .get('nluengine:5000/status')
    .end((err, res2) => {
      if (err) {
        return res.status(422).json({ success: false, errors: err })
      }

      res.json({ success: true, result: res2.body.available_projects[req.chatbot_info.uuid] })
    })
})

module.exports = router
