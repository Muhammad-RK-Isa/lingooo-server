import express from "express";
import * as dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import jwt from "jsonwebtoken";

const app = express();
const port = process.env.PORT || 5000;
dotenv.config();
app.use( express.json() );
app.use( cors() );


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
