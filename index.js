const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
//const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

//middlewire
app.use(cors())
app.use(express.json())

const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5174',
        'https://bistro-boss-167fc.web.app',

    ],
    credentials: true,
    optionSuccessStatus: 200,
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.o4eqbyc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        //await client.connect();
        // Send a ping to confirm a successful connection
        const userCollection = client.db('picoWorkerDB').collection('users');
        const taskCollection = client.db('picoWorkerDB').collection('task');
        const submissionCollection = client.db('picoWorkerDB').collection('submission');
        

        //jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '10h'
            });

            res.send({ token })
        })

        //middlewares
        const verifyToken = (req, res, next) => {

            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }

            const token = req.headers.authorization.split(' ')[1];

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {

                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }

                req.decoded = decoded;

                next();
            })

        }

        // use verify admin after verifyToken 
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        //login or reg korle chk korteci je already past e login or reg korce kina
        app.post('/users', async (req, res) => {
            const user = req.body;

            //insert email if user doesn't exist
            const query = { email: user.email }
            const isExist = await userCollection.findOne(query);

            if (isExist) {
                return res.send({ message: 'user aready exist' })
            }

            const result = await userCollection.insertOne(user);

            res.send(result)
        })

        //add a task by author
        app.post('/task', async (req, res) => {
            const item = req.body;
            const result = await taskCollection.insertOne(item);
            res.send(result);
        });

        // get all task created by a specific authur
        app.get('/my-task-list/:email', async (req, res) => {


            const email = req.params.email;
            //const tokenEmail = req.decoded.email;

            // if (tokenEmail !== email) {
            //     return res.status(403).send({ message: 'forbidden access' });
            // }

            const query = { 'author_email': email }
            const result = await taskCollection.find(query).toArray();
            res.send(result);
        })

        //delete a task by author
        app.delete('/task/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await taskCollection.deleteOne(query);
            res.send(result);
        })

        //update product korar jonno data fetch kore client e dekhabo
        app.get('/updateProduct/:id', async (req, res) => {
            const result = await taskCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        })

        //client side e update confirm korar por
        app.patch('/updateProduct/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) }
            const updatedData = req.body;
            const options = { upsert: true }
            const data = {
                $set: {
                    title: updatedData.title,
                    description: updatedData.description,
                    info: updatedData.info,
                },
            };

            const result = await taskCollection.updateOne(query, data, options);

            res.send(result);
        })

        //get all task
        app.get('/all-task', async (req, res) => {
            const result = await taskCollection.find({}).toArray();
            res.send(result);
        })

        //find details of specific task
        app.get('/details/:id', async (req, res) => {
            const result = await taskCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        })

      
        // Find user by email
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email;
            const query = { 'email': email }
            const result = await userCollection.findOne(query);
            res.send(result);
        })

        // save submitted task 
        app.post('/submission', async (req, res) => {
        const submission = req.body;
        const result = await submissionCollection.insertOne(submission);
        res.send(result);
      })






        //await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Pico worker is running')
})

app.listen(port, () => {
    console.log(`Pico worker is running at port ${port}`)
})