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

const uri = `mongodb+srv://${ process.env.MDB_USER }:${ process.env.MDB_PASSWORD }@cluster0.9wh3o6k.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient( uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
} );

// ! ------------------------------- JWT Auth Start -----------------------------------
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


// ! ------------------------------ MongoDB Start -------------------------------------

// ! ------------------------------ MongoDB End ---------------------------------------



app.get( '/', ( req, res ) => {
    res.send( "Hello from Lingooo's server" );
} );

app.listen( port, async () => {
    "Lingooo's server is running on port 5000";
} );
