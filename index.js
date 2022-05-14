const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 5000;
require("dotenv").config();
const app = express();

// use middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s4oup.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    console.log("db connected");

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const services = await cursor.toArray();
      res.send(services);
    });

    // WARNING:
    // This is not the way to query
    // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date || "May 14, 2022";

      // step 1: get all service
      const services = await serviceCollection.find().toArray();
      // step 2: get the booking of that day . output: [{}, {}, {}, {}, {}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: foreach service
      services.forEach((service) => {
        // step 4: find booking for each service. output: [{}, {}, {}, {}, {}]
        const serviceBooking = bookings.filter(
          (book) => book.treatment === service.name
        );
        // step 5: select slot for service Booking. Output ["", "", "", ""]
        const booked = serviceBooking.map((s) => s.slot);
        // step 6: select slot that are not in booked
        const available = service.slots.filter(
          (slot) => !booked.includes(slot)
        );
        // step 7: set available to slots to make it easier.
        service.slots = available;
      });

      res.send(services);
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };

      const exist = await bookingCollection.findOne(query);

      if (exist) {
        res.send({ success: false, booking: exist });
      } else {
        const result = await bookingCollection.insertOne(booking);
        res.send({ success: true, result });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to doctors portal server!");
});

app.listen(port, () => {
  console.log(`Doctors app listening on port ${port}`);
});

/**
 *  API Naming Convention
 * app.get('/booking') get all the bookings in this collection. or get more than one or by filter
 * app.get('/booking/:id') get a specific booking
 * app.post('/booking') add a new booking
 * app.patch('/booking/id') update one in most of the case
 * app.delete('/booking/id') delete one in most of the case
 */
