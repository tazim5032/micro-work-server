const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

//middlewire
app.use(cors())
app.use(express.json())

const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5174',
        'https://micro-task-55c95.web.app',
        'https://micro-task-55c95.firebaseapp.com',

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
        const paymentCollection = client.db('picoWorkerDB').collection('payments');
        const tempCollection = client.db('picoWorkerDB').collection('temp');
        const withdrawCollection = client.db('picoWorkerDB').collection('withdraw');
        const notificationCollection = client.db('picoWorkerDB').collection('notification');



        //jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '20h'
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
            const isAdmin = user?.accountType === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // use verify author after verifyToken 
        const verifyAuthor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAuthor = user?.accountType === 'taskCreator';
            if (!isAuthor) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // use verify worker after verifyToken 
        const verifyWorker = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isWorker = user?.accountType === 'worker';
            if (!isWorker) {
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
        app.post('/task', verifyToken, verifyAuthor, async (req, res) => {
            const item = req.body;
            const result = await taskCollection.insertOne(item);
            res.send(result);
        });

        // get all task created by a specific authur
        app.get('/my-task-list/:email', verifyToken, verifyAuthor, async (req, res) => {


            const email = req.params.email;
            const tokenEmail = req.decoded.email;

            if (tokenEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { 'author_email': email }
            const result = await taskCollection.find(query).toArray();
            res.send(result);
        })


        //delete specific task
        app.delete('/task/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            try {
                // Find the task by its ID
                const task = await taskCollection.findOne(query);

                if (!task) {
                    return res.status(404).send({ message: "Task not found" });
                }

                // Update the user's coin balance
                const userQuery = { email: task.author_email };
                const updateCoin = { $inc: { coin: task.total } };
                const updatedUser = await userCollection.updateOne(userQuery, updateCoin);

                if (updatedUser.modifiedCount === 0) {
                    return res.status(500).send({ message: "Failed to update user coin balance" });
                }

                // Delete the task from the database
                const result = await taskCollection.deleteOne(query);

                res.send(result);
            } catch (error) {
                console.error('Error deleting task:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


        //update product korar jonno data fetch kore client e dekhabo
        app.get('/updateProduct/:id', verifyToken, verifyAuthor, async (req, res) => {
            const result = await taskCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        })

        //client side e update confirm korar por
        app.patch('/updateProduct/:id', verifyToken, async (req, res) => {
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


        // Endpoint to get paginated tasks
        app.get('/all-task', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            const totalTasks = await taskCollection.countDocuments();
            const tasks = await taskCollection.find().skip(skip).limit(limit).toArray();

            res.send({
                tasks,
                totalTasks,
                totalPages: Math.ceil(totalTasks / limit),
                currentPage: page
            });
        });

        // Endpoint to get featured tasks
        app.get('/all-featured-task', async (req, res) => {

            const task = req.body;
            const result = await taskCollection.find(task).toArray;

            res.send(result)
        });


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

        // get all task submission for a specific user
        app.get('/user-submission/:email', verifyToken, verifyWorker, async (req, res) => {

            const tokenEmail = req.decoded.email;
            const email = req.params.email;

            if (tokenEmail !== email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { 'worker_email': email }
            const result = await submissionCollection.find(query).toArray();
            res.send(result);
        })


        // Endpoint to get paginated submissions for a specific user
        app.get('/submission/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            const totalSubmissions = await submissionCollection.countDocuments({ 'worker_email': email });
            const submissions = await submissionCollection.find({ 'worker_email': email }).skip(skip).limit(limit).toArray();

            res.send({
                submissions,
                totalSubmissions,
                totalPages: Math.ceil(totalSubmissions / limit),
                currentPage: page
            });
        });




        //get all pending task for judging
        app.get('/status/:email/:status', verifyToken, async (req, res) => {

            //const tokenEmail = req.user.email;
            const email = req.params.email;


            // if (tokenEmail !== email) {
            //     return res.status(403).send({ message: 'forbidden access' });
            // }

            const status = req.params.status;
            const query = { author_email: email, status: status }
            const result = await submissionCollection.find(query).toArray();
            res.send(result);
        })

        // Approve task and increment coin
        app.put('/approve-task/:id', verifyToken, async (req, res) => {
            const taskId = req.params.id;
            const { worker_email, coin, title,
                author_name } = req.body;

            const taskQuery = { _id: new ObjectId(taskId) };
            const updateTask = {
                $set: {
                    status: 'Approved'
                }
            };

            const userQuery = { email: worker_email };
            const updateUser = {
                $inc: { coin: coin }
            };

            const taskResult = await submissionCollection.updateOne(taskQuery, updateTask);
            const userResult = await userCollection.updateOne(userQuery, updateUser);



            // Insert notification
            const notification = {
                message: `You have earned ${coin} from ${author_name} for 
                completing ${title}`,
                toEmail: worker_email,
                time: new Date()
            };

            await notificationCollection.insertOne(notification);


            res.send({ taskResult, userResult });
        });

        // Reject task and update status
        app.put('/reject-task/:id', verifyToken, async (req, res) => {
            const taskId = req.params.id;
            const { worker_email, title, author_name } = req.body;

            const taskQuery = { _id: new ObjectId(taskId) };
            const updateTask = {
                $set: {
                    status: 'Rejected'
                }
            };

            const taskResult = await submissionCollection.updateOne(taskQuery, updateTask);

            // Insert notification
            const notification = {
                message: `Your submission for ${title} was rejected by ${author_name}`,
                toEmail: worker_email,
                time: new Date()
            };

            await notificationCollection.insertOne(notification);

            res.send({ taskResult });
        });

        // Fetch notifications for a specific user
        app.get('/notifications/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const notifications = await notificationCollection.find({ toEmail: email }).sort({ time: -1 }).toArray();
            res.send(notifications);
        });


        // Update task creator's coin balance when add task is clicked
        app.patch('/user/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const { coin } = req.body;

            try {
                const query = { email: email };
                const update = { $set: { coin: coin } };
                const result = await userCollection.updateOne(query, update);

                res.send(result);
            } catch (error) {
                console.error('Failed to update user coin balance:', error);
                res.status(500).send({ success: false, message: 'Failed to update user coin balance' });
            }
        });

        //user admin kina chk korteci
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            // if (email !== req.decoded.email) {
            //     return res.status(403).send({ message: 'forbidden access' })
            // }

            const query = { email: email }
            const user = await userCollection.findOne(query);

            let admin = false;

            if (user) {
                admin = user.accountType === 'admin';
            }

            res.send({ admin })

        })

        //user task creator kina check korteci
        app.get('/users/creator/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            // if (email !== req.decoded.email) {
            //     return res.status(403).send({ message: 'forbidden access' })
            // }

            const query = { email: email }
            const user = await userCollection.findOne(query);

            let creator = false;

            if (user) {
                creator = user.accountType === 'taskCreator';
            }

            res.send({ creator })

        })



        // Get all users with the role 'worker'
        app.get('/users/worker', verifyToken, async (req, res) => {
            try {
                const workers = await userCollection.find({ accountType: 'worker' }).toArray();
                res.send(workers);
            } catch (error) {
                console.error('Failed to fetch workers:', error);
                res.status(500).send({ success: false, message: 'Failed to fetch workers' });
            }
        });

        // PATCH endpoint to update the role of a user
        app.patch('/users/role/:id', verifyToken, async (req, res) => {
            const userId = req.params.id;
            const newRole = req.body.accountType;

            const query = { _id: new ObjectId(userId) };

            const updateDoc = {
                $set: {
                    accountType: newRole,
                },
            };

            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        // DELETE a user by admin
        app.delete('/delete-user/:id', verifyToken, verifyAdmin, async (req, res) => {
            const userId = req.params.id;

            const query = { _id: new ObjectId(userId) };

            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        // Endpoint to get all tasks
        app.get('/tasklist', async (req, res) => {
            const result = await taskCollection.find({}).toArray();
            res.send(result);
        });


        //***********Payment related API*******************/
        app.post("/create-payment-intent", verifyToken, async (req, res) => {

            const { price } = req.body;

            const amount = parseInt(price * 100);

            // console.log(amount, 'amount inside the intent')

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        // Save the payment in the database and update user's coin balance
        app.post('/payments', verifyToken, async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);

            if (paymentResult.insertedId) {
                const userEmail = payment.email;
                const coinsToAdd = parseInt(payment.coin);
                // const updateCoin = { $inc: { coin: task.total } };
                // Update user's coin balance
                const userQuery = { email: userEmail };
                const updateDocument = {
                    $inc: { coin: coinsToAdd }  // Increment the coin balance by the amount of coins purchased
                };
                const userResult = await userCollection.updateOne(userQuery, updateDocument);

                res.send({ paymentResult, userResult });
            } else {
                res.status(500).send({ error: "Failed to save payment" });
            }
        });


        // Add temporary payment details to tempCollection
        app.post('/temp-payment', async (req, res) => {
            const { price, coins, email } = req.body;

            if (!price || !coins || !email) {
                return res.status(400).send({ error: "Missing required fields" });
            }

            const tempPayment = { price, coins, email };
            const result = await tempCollection.insertOne(tempPayment);

            if (result.insertedId) {
                res.send({ success: true });
            } else {
                res.status(500).send({ error: "Failed to save temporary payment" });
            }
        });

        //get data from tempCollection
        app.get('/temp-payment/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const paymentData = await tempCollection.findOne(query);
            res.send(paymentData);
        });

        //payment hoe jawar por tempCollection theke data delete kore dibo
        app.delete('/temp-payment/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await tempCollection.deleteOne(query);
            res.send(result);
        });

        //payment history
        app.get('/payments/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const payments = await paymentCollection.find(query).toArray();
            res.send(payments);
        });


        app.post('/withdraw', verifyToken, async (req, res) => {
            const { worker_email, worker_name, withdraw_coin,
                withdraw_amount, payment_system, account_number, withdraw_time } = req.body;

            // Ensure the user exists and has enough coins to withdraw
            const user = await userCollection.findOne({ email: worker_email });

            if (user && user.coin >= withdraw_coin) {
                // Insert the withdrawal request into the withdrawCollection
                const withdrawalRequest = {
                    worker_email,
                    worker_name,
                    withdraw_coin,
                    withdraw_amount,
                    payment_system,
                    account_number,
                    withdraw_time
                };
                const withdrawalResult = await withdrawCollection.insertOne(withdrawalRequest);

                // Update the user's coin balance and increment total_income
                //   const updatedUser = await userCollection.updateOne(
                //      { email: worker_email }
                // {
                //     $inc: {
                //         coin: -withdraw_coin,
                //         total_income: parseFloat(withdraw_amount)
                //     }
                // }
                //   );

                res.send({
                    insertedId: withdrawalResult.insertedId,
                    //updatedUser
                });
            } else {
                res.status(400).send({ message: 'Insufficient coins or user not found' });
            }
        });

        // Fetch approved submissions by user email
        app.get('/approved-submissions/:email', verifyToken, verifyWorker, async (req, res) => {
            const email = req.params.email;
            const query = { worker_email: email, status: "Approved" };
            const result = await submissionCollection.find(query).toArray();
            res.send(result);
        });

        // Count total users
        app.get('/admin/total-users', verifyToken, verifyAdmin, async (req, res) => {
            const totalUsers = await userCollection.countDocuments();
            res.send({ totalUsers });
        });

        // Count total coins
        app.get('/admin/total-coins', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.aggregate([
                { $group: { _id: null, totalCoins: { $sum: "$coin" } } }
            ]).toArray();
            const totalCoins = result[0]?.totalCoins || 0;
            res.send({ totalCoins });
        });


        // Get total payment amount and completed payments count
        app.get('/admin/total-payments', verifyToken, verifyAdmin, async (req, res) => {
            const totalPaymentsResult = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null, totalAmount: { $sum: "$price" },
                        completedPayments: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }
                    }
                }
            ]).toArray();

            const totalAmount = totalPaymentsResult[0]?.totalAmount || 0;
            const completedPayments = totalPaymentsResult[0]?.completedPayments || 0;

            res.send({ totalAmount, completedPayments });
        });

        // Get total number of payments
        app.get('/admin/total-payments-count', verifyToken, verifyAdmin, async (req, res) => {
            const totalPaymentsCount = await paymentCollection.countDocuments();
            res.send({ totalPaymentsCount });
        });

        // Fetch all withdrawal requests
        app.get('/admin/withdraw-requests', verifyToken, verifyAdmin, async (req, res) => {
            const withdrawRequests = await withdrawCollection.find().toArray();
            res.send(withdrawRequests);
        });

        // Handle payment success
        app.delete('/admin/withdraw-request/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            // Find the withdrawal request
            const withdrawRequest = await withdrawCollection.findOne(query);
            if (!withdrawRequest) {
                return res.status(404).send({ message: 'Withdrawal request not found' });
            }

            // Update the user's coin and total_income
            const userQuery = { email: withdrawRequest.worker_email };
            const update = {
                $inc: {
                    coin: -parseFloat(withdrawRequest.withdraw_coin),
                    total_income: parseFloat(withdrawRequest.withdraw_amount)
                }
            };
            await userCollection.updateOne(userQuery, update);

            // Delete the withdrawal request
            const result = await withdrawCollection.deleteOne(query);
            res.send(result);
        });

        // Fetch top 6 earners based on total income
        app.get('/top-earners', async (req, res) => {
            try {
                const topEarners = await userCollection.aggregate([
                    {
                        $match: { accountType: 'worker' }
                    },
                    {
                        $sort: { total_income: -1 }
                    },
                    {
                        $limit: 6
                    },
                    {
                        $project: {
                            email: 1,
                            name: 1,
                           // picture: 1,
                            coin: 1,
                            total_income: 1,
                            total_tasks: { $size: "$task_completions" }
                        }
                    }
                ]).toArray();

                res.send(topEarners);
            } catch (error) {
                console.error('Error fetching top earners:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });





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