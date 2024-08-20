const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const firestore = admin.firestore();

// Retry configuration for GST API calls
const maxRetries = 3;
const baseRetryDelay = 5000; // Start with 5 seconds between retries

// GST Rate
const gstRate = 0.18; // 18% GST rate

exports.generateInvoice = functions.firestore
  .document('bookings/{bookingId}')
  .onWrite(async (change, context) => {
    const bookingData = change.after.data();

    if (bookingData.status === 'finished') {
      const name = bookingData.name;
      const totalAmount = bookingData.totalBookingAmount;
      const items = bookingData.items || []; 

      // Calculate GST components
      const totalGST = totalAmount * gstRate;
      const igst = totalGST;
      const sgst = igst / 2;
      const cgst = igst / 2; // Assuming equal split for SGST and CGST

      // Generate unique invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const invoiceData = {
        invoiceNumber,
        name,
        totalAmount,
        items,
        gst: {
          totalGST,
          igst,
          sgst,
          cgst,
        },
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // GST API Integration with exponential backoff retry
      let response;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await sendInvoiceToGSTAPI(invoiceData);
          break; // Exit loop on successful response
        } catch (error) {
          const retryDelay = baseRetryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          console.error(`Error generating invoice (attempt ${attempt}/${maxRetries}): ${error.message}`);
          if (attempt === maxRetries) {
            console.error('Max retries reached. Unable to generate invoice.');
            await storeErrorDetails(context.params.bookingId, error);
            throw error; // Re-throw error on last attempt
          }
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }

      if (response.success) {
        console.log('Invoice generated successfully!', invoiceData);
        await firestore.collection('bookings').doc(context.params.bookingId).update({
          status: 'invoice generated',
          invoiceNumber,
        });
      } else {
        console.error('Failed to generate invoice:', response.error);
        await storeErrorDetails(context.params.bookingId, response.error);
      }
    }
  });

// Function to send invoice to GST API
async function sendInvoiceToGSTAPI(invoiceData) {
  const gstApiUrl = 'https://your-gst-api.com/invoices';
  const apiKey = 'your_api_key';

  try {
    const response = await axios.post(gstApiUrl, invoiceData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error sending invoice to GST API:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// Function to store error details for manual intervention
async function storeErrorDetails(bookingId, error) {
  const errorData = {
    bookingId,
    errorMessage: error.message,
    errorStack: error.stack,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  await firestore.collection('invoiceErrors').add(errorData);
  console.error('Stored error details:', errorData);
}

// Function to test GST API integration (simulated environment)
async function testGSTAPIIntegration() {
  // Create a mock invoice data for testing
  const mockInvoiceData = {
    invoiceNumber: 'TEST-INV-001',
    name: 'Test Customer',
    totalAmount: 1000,
    items: ['Test Item 1', 'Test Item 2'],
    gst: {
      totalGST: 180,
      igst: 180,
      sgst: 90,
      cgst: 90,
    },
    generatedAt: new Date(),
  };

  try {
    const response = await sendInvoiceToGSTAPI(mockInvoiceData);
    console.log('Test GST API Integration Success:', response);
  } catch (error) {
    console.error('Test GST API Integration Failed:', error.message);
  }
}

//  Generally we havr to Uncomment the line below to run the test function manually
// testGSTAPIIntegration();
