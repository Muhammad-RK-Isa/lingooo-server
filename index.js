import express from "express";
import * as dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import jwt from "jsonwebtoken";
import SlowDown from "express-slow-down";
import Stripe from 'stripe';

const stripe = new Stripe( process.env.STRIPE_SECRET_KEY );

const app = express();
const port = process.env.PORT || 5000;
dotenv.config();
app.use( express.json() );
app.use( cors() );

// ? -------------------------------Speed Limiter Start------------------------------
// const speedLimiter = SlowDown( {
//     windowMs: 60 * 100,
//     delayAfter: 0,
//     delayMs: 500
// } );

// app.use( speedLimiter );

// Middleware function to introduce a delay
const delayMiddleware = ( req, res, next ) => {
    const delay = 1000; // Delay in milliseconds (adjust as needed)
    setTimeout( next, delay );
};
// ? -------------------------------Speed Limiter End-------------------


// ! ================================ JWT Auth Start =================================
app.post( '/auth/request_access_token', ( req, res ) => {
    const { uid } = req.body;
    const token = jwt.sign( uid, process.env.ACCESS_TOKEN_SECRET );
    res.send( { token } );
} );

const verifyJWT = ( req, res, next ) => {
    const { authorization } = req.headers;
    if ( !authorization ) {
        return res.status( 401 ).send( { error: true, message: 'Unauthorized' } );
    }
    const token = authorization.split( ' ' )[ 1 ];

    jwt.verify( token, process.env.ACCESS_TOKEN_SECRET, ( err, decoded ) => {
        if ( err ) {
            return res.status( 403 ).send( { error: true, message: 'Forbidden' } );
        }
        req.decoded = decoded;
        next();
    } );
};

// ! ------------------------------- JWT Auth End -------------------------------------



// ! ============================== MongoDB Start =====================================
const uri = `mongodb+srv://${ process.env.MDB_USER }:${ process.env.MDB_PASSWORD }@cluster0.9wh3o6k.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient( uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
} );

const run = async () => {
    try {
        client.connect();

        // ? Retrieve database and collections
        const db = client.db( "lingooo" );
        const classesCollection = db.collection( "classes" );
        const usersCollection = db.collection( "users" );
        const flagsCollection = db.collection( "flags" );

        // ? Retrieve classes with 'quantity' query. Get all if 'quantity' is not provided
        app.get( '/classes', async ( req, res ) => {
            const { quantity, filter } = req.query;

            let pipeline = [];

            if ( filter ) {
                switch ( filter.filter ) {
                    case 'Sort by name A-Z':
                        pipeline.push( { $sort: { title: 1 } } );
                        break;
                    case 'Sort by name Z-A':
                        pipeline.push( { $sort: { title: -1 } } );
                        break;
                    case 'Sort by price high to low':
                        pipeline.push( { $sort: { price: -1 } } );
                        break;
                    case 'Sort by price low to high':
                        pipeline.push( { $sort: { price: 1 } } );
                        break;
                    case 'Sort by popularity ascending':
                        pipeline.push( { $sort: { enrolled: 1 } } );
                        break;
                    case 'Sort by popularity descending':
                        pipeline.push( { $sort: { enrolled: -1 } } );
                        break;
                    case 'Sort by availability ascending':
                        pipeline.push( { $sort: { availableSeats: 1 } } );
                        break;
                    case 'Sort by availability descending':
                        pipeline.push( { $sort: { availableSeats: -1 } } );
                        break;
                    default:
                        break;
                }
            }

            if ( quantity ) {
                pipeline.push( { $limit: parseInt( quantity ) } );
            }

            const classes = await classesCollection.aggregate( pipeline ).toArray();
            res.send( classes );
        } );


        // ?-----------------------User authorozation and data manipulation in mongodb userbase related api start-----------------------

        // ? Role varification middlewares
        const isStudent = async ( req, res, next ) => {
            const uid = req.decoded;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, role: 1 } }
            ];
            try {
                const result = await usersCollection.aggregate( pipeline ).toArray();
                if ( result[ 0 ]?.role === 'student' ) {
                    next();
                }
            } catch ( error ) {
                console.log( 'not a student' );
                res.status( 403 ).send( 'Forbidden' );
            }
        };
        const isInstructor = async ( req, res, next ) => {
            const { uid } = req.body;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, role: 1 } }
            ];
            try {
                const result = await usersCollection.aggregate( pipeline ).toArray();
                if ( result[ 0 ]?.role === 'instructor' ) {
                    next();
                }
            } catch ( error ) {
                res.status( 403 ).send( 'Forbidden' );
            }
        };
        const isAdmin = async ( req, res, next ) => {
            const { uid } = req.body;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, role: 1 } }
            ];
            try {
                const result = await usersCollection.aggregate( pipeline ).toArray();
                if ( result[ 0 ]?.role === 'admin' ) {
                    next();
                }
            } catch ( error ) {
                res.status( 403 ).send( 'Forbidden' );
            }
        };

        // ? Verify user role and send client role to client side
        app.get( '/auth/verify_user_role/:uid', verifyJWT, async ( req, res ) => {
            const { uid } = req.params;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, role: 1 } }
            ];

            const result = await usersCollection.aggregate( pipeline ).toArray();
            res.send( result[ 0 ] );
        } );

        // ? Add new user to database
        app.post( '/auth/add_user', async ( req, res ) => {
            const { uid, displayName, photoURL, email } = req.body;

            const user = {
                uid,
                displayName,
                photoURL,
                email,
                role: 'student',
                sellectedClasses: [],
                enrolledClasses: [],
                reviews: []
            };

            const existingUser = await usersCollection.findOne( { uid } );
            if ( !existingUser ) {
                const result = await usersCollection.insertOne( user );
                res.send( { result } );
            } else {
                res.send( { error: true, message: 'User already exists' } );
            }
        } );
        // ?-----------------------User authorozation and data manipulation in mongodb userbase related api end-----------------------


        // ! ------------------------------Instructors Section Start------------------------------
        // ? Get all instructors
        app.get( '/instructors', async ( req, res ) => {
            const result = await usersCollection.find( { role: 'instructor' } ).toArray();
            res.send( result );
        } );

        // ? Get students count of an instructor
        app.get( '/instructors/students/count/:uid', async ( req, res ) => {
            const { uid } = req.params;

            const pipeline = [
                { $match: { "instructor.uid": uid } },
                {
                    $group: {
                        _id: null,
                        totalEnrollments: { $sum: '$enrolled' }
                    }
                },
                { $project: { _id: 0, totalEnrollments: 1 } }

            ];
            const result = await classesCollection.aggregate( pipeline ).toArray();
            const totalEnrollments = result.length > 0 ? result[ 0 ] : { totalEnrollments: 0 };
            res.send( totalEnrollments );
        } );

        // ? Get all the classes of an instructor
        app.get( '/instructors/classes/:uid', async ( req, res ) => {
            const { uid } = req.params;
            const result = await classesCollection.find( { 'instructor.uid': uid } ).toArray();
            res.send( result );
        } );


        // ? Get flag by name
        app.get( '/flags/single/:name', async ( req, res ) => {
            const { name } = req.params;

            const pipeline = [
                { $match: { name } },
                { $project: { _id: 0, image: 1 } }
            ];

            const result = await flagsCollection.aggregate( pipeline ).toArray();;

            if ( result.length > 0 ) {
                const { image } = result[ 0 ];
                res.send( image );
            } else {
                res.status( 404 ).json( { error: 'Flag not found' } );
            }
        } );

        // ? Get all flags according to an instructor's classes' languages
        app.get( '/flags/instructor/:uid', async ( req, res ) => {
            const { uid } = req.params;
            try {
                const classes = await classesCollection.find( { 'instructor.uid': uid } ).toArray();
                const languageNames = [ ...new Set( classes.map( ( classData ) => classData.language ) ) ];
                const flags = await flagsCollection.find( { name: { $in: languageNames } } ).limit( 2 ).project( { _id: 0, image: 1 } ).toArray();
                const flagImageLinks = flags.map( ( flag ) => flag.image );
                res.send( flagImageLinks );
            } catch ( error ) {
                console.error( 'Error retrieving flags:', error );
                res.status( 500 ).json( { error: 'Failed to retrieve flags' } );
            }
        } );
        // ! ------------------------------Instructors Section End------------------------------

        // ----------------------------------Student Section------------------------------------
        app.patch( '/users/add_class', verifyJWT, isStudent, async ( req, res ) => {
            const { uid, classId } = req.body;

            try {
                const result = await usersCollection.updateOne(
                    { uid },
                    { $addToSet: { selectedClasses: String( classId ) } }
                );
                if ( result.acknowledged && result.modifiedCount !== 0 ) {
                    res.status( 200 ).json( { message: 'Selected classes updated successfully' } );
                } else if ( result.modifiedCount === 0 ) {
                    res.status( 409 ).json( { error: 'Class already selected' } );
                }
                else {
                    res.status( 500 ).json( { error: 'Failed to update selected classes' } );
                }
            } catch ( error ) {
                res.status( 500 ).json( { error: 'An error occurred while updating selected classes' } );
            }
        } );

        app.get( '/users/students/selectedClasses/:uid', verifyJWT, async ( req, res ) => {
            const { uid } = req.params;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, selectedClasses: 1 } }
            ];
            const result = await usersCollection.aggregate( pipeline ).toArray();

            const classIds = result[ 0 ]?.selectedClasses || [];
            const classPromises = classIds.map( async ( _id ) => {
                const classs = await classesCollection.findOne( { _id: new ObjectId( _id ) } );
                return classs;
            } );

            const classes = await Promise.all( classPromises );

            res.send( classes );
        } );

        app.get( '/users/students/enrolledClasses/:uid', verifyJWT, async ( req, res ) => {
            const { uid } = req.params;
            const pipeline = [
                { $match: { uid } },
                { $project: { _id: 0, enrolledClasses: 1 } }
            ];
            const result = await usersCollection.aggregate( pipeline ).toArray();

            const classIds = result[ 0 ]?.selectedClasses || [];
            const classPromises = classIds.map( async ( _id ) => {
                const classs = await classesCollection.findOne( { _id: new ObjectId( _id ) } );
                return classs;
            } );

            const classes = await Promise.all( classPromises );

            res.send( classes );
        } );
        // ? Get all the reviews made by a student
        app.get( '/student/reviews', verifyJWT, isStudent, async ( req, res ) => {
            const uid = req.decoded;
            try {
                const pipeline = [
                    { $match: { uid } },
                    { $project: { _id: 0, reviews: 1 } }
                ];
                const reviews = await usersCollection.aggregate( pipeline ).toArray();
                res.send( reviews[ 0 ].reviews );
            } catch ( error ) {
                console.error( 'Error retrieving reviews:', error );
                res.status( 500 ).json( { error: 'Failed to retrieve reviews' } );
            }
        } );

        // ? Get all the reviews made by students
        app.get( '/reviews', async ( req, res ) => {
            try {
                const users = await usersCollection.find( { role: "student" } ).toArray();

                // Combine review arrays into a single array of objects
                const allReviews = users.flatMap( user => {
                    if ( user.reviews && user.reviews.length > 0 ) {
                        return user.reviews.map( review => ( {
                            displayName: user.displayName,
                            photoURL: user.photoURL,
                            review
                        } ) );
                    }
                    return [];
                } );
                res.send( allReviews );
            } catch ( error ) {
                console.error( 'Error retrieving reviews:', error );
                res.status( 500 ).json( { error: 'Failed to retrieve reviews' } );
            }
        } );

        // ? Delete a selected class
        app.delete( '/student/selected_classes/:_id', verifyJWT, isStudent, async ( req, res ) => {
            const uid = req.decoded;
            const _id = req.params._id;

            try {
                const result = await usersCollection.updateOne(
                    { uid },
                    { $pull: { selectedClasses: _id } }
                );
                if ( result.modifiedCount === 1 ) {
                    res.status( 200 ).json( { message: 'Selected class deleted successfully' } );
                } else {
                    res.status( 409 ).json( { error: 'The selected class not found' } );
                }
            } catch ( error ) {
                res.status( 500 ).json( { error: 'An error occurred while deleting the selected class' } );
            }
        } );
        // ----------------------------------Student Section End------------------------------------

        // ----------------------------Payment-----------------------------------------
        app.post( 'create-payment-intent', verifyJWT, async ( req, res ) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create( {
                amount,
                currency: 'usd',
                payment_method_types: [ "card" ]
            } );

            res.send( { clientSecret: paymentIntent.client_secret } );
        } );
        // ----------------------------------Student Section------------------------------------

        // Send a ping to confirm a successful connection
        await client.db( "admin" ).command( { ping: 1 } );
        console.log( "Pinged your deployment. You successfully connected to MongoDB!" );
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
};
run().catch( console.dir );

// ! ------------------------------ MongoDB End ---------------------------------------



app.get( '/', verifyJWT, ( req, res ) => {
    res.send( "Hello from Lingooo's server" );
} );

app.listen( port, async () => {
    "Lingooo's server is running on port 5000";
} );
