const { https } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

// Define secrets for OAuth
const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

/**
 * Cloud Function: Exchange Google OAuth Code for Tokens (iOS/Mac Catalyst)
 * 
 * Called from iOS app after ASWebAuthenticationSession redirect.
 * Exchanges the authorization code for access/refresh tokens and returns
 * credentials for Firebase sign-in.
 */
exports.exchangeGoogleOAuthCode = https.onCall(
  {
    secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
  },
  async (request) => {
    const { code, clientId, redirectUri } = request.data;

    // Validate input
    if (!code || !clientId || !redirectUri) {
      throw new Error('Missing required parameters: code, clientId, redirectUri');
    }

    try {
      // Step 1: Exchange authorization code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: String(code),
          client_id: String(clientId),
          client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''),
          redirect_uri: String(redirectUri),
          grant_type: 'authorization_code',
        }).toString(),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('Google OAuth token exchange failed:', tokenData);
        throw new Error(
          `Token exchange failed: ${tokenData.error_description || tokenData.error || 'Unknown error'}`
        );
      }

      // Validate we got required tokens
      if (!tokenData.access_token) {
        throw new Error('No access_token returned from Google');
      }

      // Step 2: Fetch user info to get ID
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      const userData = await userResponse.json();

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user info: ${userData.error}`);
      }

      // Step 3: Create Firebase custom token (or use ID token)
      // For iOS, we return the ID token if available, otherwise create custom token
      let firebaseToken;

      if (tokenData.id_token) {
        // Use the ID token from Google
        firebaseToken = tokenData.id_token;
      } else {
        // Fallback: Create Firebase custom token for this user
        // This requires the user to exist in Firebase Auth or be created first
        const uid = userData.id || userData.email?.split('@')[0];
        firebaseToken = await admin.auth().createCustomToken(uid, {
          provider: 'google',
          email: userData.email,
        });
      }

      // Step 4: Store tokens in Firestore for later use (OAuth token refresh)
      // This allows backend to call Google APIs on behalf of the user
      if (request.auth && request.auth.uid) {
        const db = admin.firestore();
        await db.collection('tokens').doc(request.auth.uid).set(
          {
            provider: 'google',
            refresh_token: tokenData.refresh_token || null,
            access_token: tokenData.access_token,
            access_at: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            scope: tokenData.scope || '',
          },
          { merge: true }
        );
      }

      // Return credentials for Firebase sign-in
      return {
        success: true,
        idToken: firebaseToken,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresIn: tokenData.expires_in || 3600,
        email: userData.email,
        userId: userData.id,
      };
    } catch (error) {
      console.error('OAuth code exchange error:', error);
      throw new Error(`OAuth exchange failed: ${error.message}`);
    }
  }
);

/**
 * Alternative for iOS: Use Firebase SDK's signInWithCredential instead
 * This function can be called before Firebase auth is set up.
 * iOS client will use the returned tokens with GoogleAuthProvider.credential()
 */
exports.exchangeGoogleOAuthCodeLite = https.onCall(
  {
    secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
  },
  async (request) => {
    const { code, clientId, redirectUri } = request.data;

    if (!code || !clientId || !redirectUri) {
      throw new Error('Missing required parameters: code, clientId, redirectUri');
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: String(code),
          client_id: String(clientId),
          client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''),
          redirect_uri: String(redirectUri),
          grant_type: 'authorization_code',
        }).toString(),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(
          `Token exchange failed: ${tokenData.error_description || tokenData.error}`
        );
      }

      return {
        success: true,
        idToken: tokenData.id_token,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiresIn: tokenData.expires_in || 3600,
      };
    } catch (error) {
      console.error('OAuth lite exchange error:', error);
      throw new Error(`OAuth exchange failed: ${error.message}`);
    }
  }
);
