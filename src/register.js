const crypto = require('crypto');
const AndroidFCM = require('@liamcottle/push-receiver/src/android/fcm');

const RUST_PLUS = {
    apiKey: 'AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY',
    projectId: 'rust-companion-app',
    gcmSenderId: '976529667804',
    gmsAppId: '1:976529667804:android:d6f1ddeb4403b338fea619',
    androidPackageName: 'com.facepunch.rust.companion',
    androidPackageCert: 'E28D05345FB78A7A1A63D70F4A302DBF426CA5AD'
};
const LOGIN_URL = 'https://companion-rust.facepunch.com/login';

async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (res.status === 401 || res.status === 403) throw new Error(`${new URL(url).host} refused the login (${res.status}). Sign in again — if it keeps failing, Rust+ may be down.`);
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => ({}));
}

async function register(getSteamToken, progress = () => {}) {
    progress(1, 'Registering this PC for push notifications…');
    const c = RUST_PLUS;
    const fcm = await AndroidFCM.register(c.apiKey, c.projectId, c.gcmSenderId, c.gmsAppId, c.androidPackageName, c.androidPackageCert);

    progress(2, 'Getting a Rust+ push token…');
    const expo = await post('https://exp.host/--/api/v2/push/getExpoPushToken', {
        type: 'fcm', deviceId: crypto.randomUUID(), development: false,
        appId: 'com.facepunch.rust.companion', deviceToken: fcm.fcm.token, projectId: '49451aca-a822-41e6-ad59-955718d0ff9c'
    });
    const expoPushToken = expo.data.expoPushToken;

    progress(3, 'Sign in with Steam to link it to Rust+.');
    const authToken = await getSteamToken();

    progress(4, 'Registering with Rust+…');
    await post('https://companion-rust.facepunch.com:443/api/push/register', {
        AuthToken: authToken, DeviceId: 'scrapscout', PushKind: 3, PushToken: expoPushToken
    });
    return { fcm_credentials: fcm, expo_push_token: expoPushToken, rustplus_auth_token: authToken };
}

module.exports = { register, LOGIN_URL };
