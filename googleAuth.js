/**
 * @param {object} serviceAccountKey - The service account credentials object
 * @returns {Promise<string>} Access token
 */
async function authenticateServiceAccount(serviceAccountKey) {
  try {
    // Validate credentials type
    if (serviceAccountKey.installed || serviceAccountKey.web) {
      throw new Error(
        '❌ Error: Tipo de credenciales incorrecto.\n' +
        'Estás usando credenciales OAuth2, pero se requieren credenciales de Service Account.\n\n' +
        'Para obtener las credenciales correctas:\n' +
        '1. Ve a https://console.cloud.google.com/\n' +
        '2. Selecciona tu proyecto\n' +
        '3. Ve a "IAM & Admin" → "Service Accounts"\n' +
        '4. Crea una Service Account y descarga la clave JSON\n' +
        '5. Reemplaza credentials.json con ese archivo\n' +
        '6. Comparte la hoja de Google Sheets con el email de la Service Account'
      );
    }

    if (!serviceAccountKey.private_key || !serviceAccountKey.client_email) {
      throw new Error(
        '❌ Error: Credenciales de Service Account incompletas.\n' +
        'Faltan campos: private_key o client_email'
      );
    }

    // Create JWT
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const claimSet = {
      iss: serviceAccountKey.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    // Encode header and claim set
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    // Sign with private key
    const signature = await signJWT(signatureInput, serviceAccountKey.private_key);
    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;

  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

/**
 * Sign JWT using RS256
 */
async function signJWT(message, privateKey) {
  // Import the private key
  const pemKey = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  
  const binaryKey = base64ToArrayBuffer(pemKey);
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  // Sign the message
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    data
  );

  return base64UrlEncode(signature);
}

/**
 * Helper: Base64 URL encode
 */
function base64UrlEncode(input) {
  let base64;
  
  if (typeof input === 'string') {
    base64 = btoa(unescape(encodeURIComponent(input)));
  } else if (input instanceof ArrayBuffer) {
    const bytes = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Helper: Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * @param {string} sheetId - The sheet (tab) name
 * @param {string} column - Column letter (e.g., 'A', 'B', 'C')
 * @param {number} row - Row number (1-based index)
 * @param {string} archiveId - The Google Sheets spreadsheet ID
 * @param {string} accessToken - Access token from authentication
 * @returns {Promise<any>} The cell value
 */
async function readFromSheet(sheetId, column, row, archiveId, accessToken) {
  try {
    const range = `${sheetId}!${column}${row}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${archiveId}/values/${range}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to read: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.values?.[0]?.[0] || null;
      
  } catch (error) {
    console.error('Error reading from sheet:', error);
    throw error;
  }
}

/**
 * @param {string} sheetId - The sheet (tab) name
 * @param {string} column - Column letter (e.g., 'A', 'B', 'C')
 * @param {number} row - Row number (1-based index)
 * @param {string} archiveId - The Google Sheets spreadsheet ID
 * @param {any} value - The value to write
 * @param {string} accessToken - Access token from authentication
 * @returns {Promise<object>} Response from the API
 */
async function writeToSheet(sheetId, column, row, archiveId, value, accessToken) {
  try {
    const range = `${sheetId}!${column}${row}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${archiveId}/values/${range}?valueInputOption=RAW`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [[value]]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to write: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
    
  } catch (error) {
    console.error('Error writing to sheet:', error);
    throw error;
  }
}

/**
 * Get range of values from sheet
 * @param {string} sheetId - The sheet (tab) name
 * @param {string} range - Range in A1 notation (e.g., 'A:A', 'A1:B10')
 * @param {string} archiveId - The Google Sheets spreadsheet ID
 * @param {string} accessToken - Access token from authentication
 * @returns {Promise<Array>} Array of rows
 */
async function readRange(sheetId, range, archiveId, accessToken) {
  try {
    const fullRange = `${sheetId}!${range}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${archiveId}/values/${fullRange}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to read range: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.values || [];
      
  } catch (error) {
    console.error('Error reading range from sheet:', error);
    throw error;
  }
}

/**
 * Sheets Manager - Handles authentication and caching
 */
class SheetsManager {
  constructor(serviceAccountKey) {
    this.serviceAccountKey = serviceAccountKey;
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  async getAccessToken() {
    const now = Date.now();
    
    // Reuse token if still valid (with 5 min buffer)
    if (this.accessToken && now < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    // Get new token
    this.accessToken = await authenticateServiceAccount(this.serviceAccountKey);
    this.tokenExpiry = now + 3600000; // 1 hour
    
    return this.accessToken;
  }

  async read(sheetId, column, row, archiveId) {
    const token = await this.getAccessToken();
    return readFromSheet(sheetId, column, row, archiveId, token);
  }

  async write(sheetId, column, row, archiveId, value) {
    const token = await this.getAccessToken();
    return writeToSheet(sheetId, column, row, archiveId, value, token);
  }

  /**
   * Read a range of cells
   * @param {string} sheetId - The sheet (tab) name
   * @param {string} range - Range in A1 notation (e.g., 'A:A', 'A1:B10')
   * @param {string} archiveId - The Google Sheets spreadsheet ID
   * @returns {Promise<Array>} Array of rows
   */
  async readRange(sheetId, range, archiveId) {
    const token = await this.getAccessToken();
    return readRange(sheetId, range, archiveId, token);
  }

  /**
   * Get the last row number with data in a specific column
   * @param {string} sheetId - The sheet (tab) name
   * @param {string} column - Column letter (e.g., 'A', 'B', 'C')
   * @param {string} archiveId - The Google Sheets spreadsheet ID
   * @returns {Promise<number>} Last row number (1-based)
   */
  async getLastRow(sheetId, column, archiveId) {
    const token = await this.getAccessToken();
    const values = await readRange(sheetId, `${column}:${column}`, archiveId, token);
    return values.length || 1; // Return 1 if empty (no data)
  }

  /**
   * Read the value from the last row in a column
   * @param {string} sheetId - The sheet (tab) name
   * @param {string} column - Column letter (e.g., 'A', 'B', 'C')
   * @param {string} archiveId - The Google Sheets spreadsheet ID
   * @returns {Promise<any>} Value from the last row
   */
  async readLastRow(sheetId, column, archiveId) {
    const lastRow = await this.getLastRow(sheetId, column, archiveId);
    if (lastRow === 0) return null;
    return this.read(sheetId, column, lastRow, archiveId);
  }
}

export { SheetsManager };