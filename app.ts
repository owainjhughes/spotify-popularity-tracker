import express, { Request, Response } from 'express';
import request from 'request';
import cors from 'cors';
import querystring from 'querystring';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';
import path from 'path';
import { renderFile } from 'ejs';

// Building the app
const app = express();
app.use(express.static(path.join(__dirname, '/templates')))
    .use(cors())
    .use(cookieParser())
    .engine('html', renderFile)
    .set('view engine', 'html');

// Spotify App credentials
const redirect_uri = process.env.NODE_ENV === 'production' 
    ? 'https://spotify-popularity-tracker.vercel.app/callback'
    : 'http://localhost:8888/callback'; 
const client_id = process.env.client_id as string;
const client_secret = process.env.client_secret as string;
const state_key = 'spotify_auth_state';
const scope = 'user-follow-read';

// Type for artist information
interface ArtistInfo {
    name: string;
    popularity: number;
}

// Function that generates a random string to use as the app's state as a security measure
const generate_random_string = (): string => {
    let string = '';
    const possible_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    for (let i = 0; i < 16; i++) {
        string += possible_chars.charAt(Math.floor(Math.random() * possible_chars.length));
    }
    return string;
};

app.get('/login', (req: Request, res: Response) => {
    // Authorizes user with Spotify, sends client information in URL
    const state = generate_random_string();
    res.cookie(state_key, state);

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state,
            show_dialog: true
        }));
});

app.get('/callback', (req: Request, res: Response) => {
    const code = req.query.code as string || null;
    const state = req.query.state as string || null;
    const stored_state = req.cookies ? req.cookies[state_key] : null;

    if (state === null || state !== stored_state) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'incorrect state'
            }));
    } else {
        res.clearCookie(state_key);
        // Necessary stuff to send to receive an access token
        const auth_options = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (Buffer.from(client_id + ':' + client_secret).toString('base64'))
            },
            json: true
        };

        // Request access token and then request the user's followed artists
        request.post(auth_options, (error: any, response: request.Response, body: any) => {
            if (!error && response.statusCode === 200) {
                const access_token = body.access_token;

                get_all_followed(access_token)
                    .then(artist_info => {
                        const data = Object.values(artist_info).map((item) => item.popularity);
                        const scores = get_score_stats(data);
                        res.render(path.join(__dirname, '/templates/artists.html'), { artist_info: artist_info, scores: scores });
                    })
                    .catch(error => {
                        console.error(error);
                    });
            }
        });
    }
});

// Function to get all the artists a user follows on Spotify
// Limit and offset needed to gain artists above an index of 50, since the
// Spotify API only sends 50 objects per API call
async function get_all_followed(access_token: string): Promise<ArtistInfo[]> {
    const limit = 50;
    let offset = 0;
    let total = 1;
    let artists: any[] = [];

    const get_artists = async (): Promise<any[]> => {
        while (artists.length < total) {
            const response = await fetch(`https://api.spotify.com/v1/me/following?type=artist&limit=${limit}&offset=${offset}`, {
                headers: {
                    'Authorization': 'Bearer ' + access_token
                }
            });

            const data = await response.json() as any;
            total = data.artists.total;
            offset += limit;
            artists.push(...data.artists.items);
        }
        return artists;
    };

    const artist_data = await get_artists();
    const artist_info: ArtistInfo[] = artist_data.map(artist => ({ 
        name: artist.name, 
        popularity: artist.popularity 
    }));
    return artist_info;
}

// Find the lowest, highest and average score, used for statistics on a user's library
function get_score_stats(data: number[]): [number, number, number] {
    if (data.length === 0) {
        return [0, 0, 0];
    }
    
    let sum = data[0];
    let highest = data[0];
    let lowest = data[0];
    
    for (let i = 1; i < data.length; i++) {
        if (data[i] > highest) {
            highest = data[i];
        }
        if (data[i] < lowest) {
            lowest = data[i];
        }
        sum = sum + data[i];
    }
    return [highest, lowest, Math.round(sum/data.length)];
}

// For local development
if (process.env.NODE_ENV !== 'production') {
    console.log('Listening on 8888');
    app.listen(8888);
}

// Required for Vercel
export default app;
export const config = {
    api: {
        bodyParser: true,
    },
};