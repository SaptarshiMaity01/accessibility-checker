import express from 'express';
import cors from 'cors';
import pa11y from 'pa11y';
import puppeteer from 'puppeteer';
import axeCore from 'axe-core';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Global browser instance (consider using puppeteer-cluster in production)
let browser;

// Initialize browser instance
async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote'
      ],
      timeout: 120000
    });
  }
  return browser;
}

// Function to run axe-core tests with robust error handling
async function runAxe(url) {
  let page;
  try {
    const browser = await initBrowser();
    page = await browser.newPage();
    
    // Configure page settings
    await page.setDefaultNavigationTimeout(120000);
    await page.setDefaultTimeout(60000);
    await page.setBypassCSP(true); // Important for axe-core to work properly

    // Event listeners for debugging
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('Page error:', error));

    // Navigate to page with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.log(`Retrying navigation (${retries} attempts left)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Inject and run axe-core with proper context
    await page.evaluate(axeCore.source);
    const results = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Axe-core analysis timed out'));
        }, 30000);

        window.axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']
          }
        }, (err, results) => {
          clearTimeout(timeout);
          if (err) return reject(err);
          resolve(results);
        });
      });
    });

    return results;
  } catch (error) {
    console.error('Axe-core testing error:', error);
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(e => console.error('Page close error:', e));
    }
  }
}

// Test endpoint
app.post('/api/test', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Run tests with proper error handling
    const [axeResults, pa11yResults] = await Promise.allSettled([
      runAxe(url),
      pa11y(url, {
        includeWarnings: true,
        standard: 'WCAG2AA',
        runners: ['htmlcs'], // Removed 'axe' to avoid duplication
        timeout: 60000,
        wait: 3000,
        chromeLaunchConfig: {
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      })
    ]);

    // Process results
    const processedResults = {
      axe: axeResults.status === 'fulfilled' ? axeResults.value : {
        error: 'Axe-core test failed',
        details: axeResults.reason?.message || 'Unknown error',
        violations: [],
        passes: []
      },
      pa11y: pa11yResults.status === 'fulfilled' ? pa11yResults.value : {
        error: 'Pa11y test failed',
        details: pa11yResults.reason?.message || 'Unknown error',
        issues: [],
        passes: []
      }
    };

    // Generate summary
    const summary = {
      critical: ((processedResults.axe.error ? 0 : processedResults.axe.violations?.filter(v => v.impact === 'critical').length || 0) +
                (processedResults.pa11y.error ? 0 : processedResults.pa11y.issues?.filter(i => i.type === 'error').length || 0)),
      serious: ((processedResults.axe.error ? 0 : processedResults.axe.violations?.filter(v => v.impact === 'serious').length || 0) +
               (processedResults.pa11y.error ? 0 : processedResults.pa11y.issues?.filter(i => i.type === 'warning').length || 0)),
      moderate: ((processedResults.axe.error ? 0 : processedResults.axe.violations?.filter(v => v.impact === 'moderate').length || 0) +
                (processedResults.pa11y.error ? 0 : processedResults.pa11y.issues?.filter(i => i.type === 'notice').length || 0))
    };

    res.json({
      ...processedResults,
      summary
    });
  } catch (error) {
    console.error('Error running accessibility test:', error);
    res.status(500).json({ 
      error: 'Failed to run accessibility test',
      details: error.message
    });
  }
});

app.get('/api/groq-key', (req, res) => {
  try {
    // In production, you might get this from:
    // - Environment variables
    // - Secure secret storage
    // - Database
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'Groq API key not configured on server' });
    }
    
    res.json({ apiKey });
  } catch (error) {
    console.error('Error getting Groq API key:', error);
    res.status(500).json({ error: 'Failed to get Groq API key' });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit();
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});