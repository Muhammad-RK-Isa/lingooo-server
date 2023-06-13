import express from "express";
import * as dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import jwt from "jsonwebtoken";
import SlowDown from "express-slow-down";

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
const verifyJWT = ( req, res, next ) => {
    const { authorization } = req.headers;
    const token = authorization.split( ' ' )[ 1 ];

    jwt.verify( token, process.env.ACCESS_TOKEN_SECRET, ( err, decoded ) => {
        if ( err ) {
            return res.status( 403 ).send( { error: true, message: 'Forbidden' } );
        }
        next();
    } );
};

app.post( '/auth/request_access_token', ( req, res ) => {
    const { uid } = req.body;
    const token = jwt.sign( uid, process.env.ACCESS_TOKEN_SECRET );
    res.send( { token } );
} );

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
            const { quantity } = req.query;
            if ( quantity ) {
                const classes = await classesCollection.find().limit( parseInt( quantity ) ).toArray();
                res.send( classes );
            } else {
                const classes = await classesCollection.find().toArray();
                res.send( classes );
            }
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
        // ! ------------------------------Instructors Section Start------------------------------

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



app.get( '/', ( req, res ) => {
    res.send( "Hello from Lingooo's server" );
} );

app.listen( port, async () => {
    "Lingooo's server is running on port 5000";
} );
