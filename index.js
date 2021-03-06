const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// use middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s4oup.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers?.authorization;
  const token = authHeader?.split(" ")[1];
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized Access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
};

const emailSenderOptions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));
function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;
  const email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
      <p>Hello ${patientName} </p>
      <div>Your appointment for ${treatment} is confirmed.</div>
      <p>Looking forward to seeing you on ${date} at ${slot}</p>

      <h3>Our Address</h3>
      <h3>Andor kella bandorban</h3>
      <p>Bangladesh</p>
      <a href="https://web.programming-hero.com">unsubscribe</a>

    `,
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const userCollection = client.db("doctors_portal").collection("user");
    const doctorCollection = client.db("doctors_portal").collection("doctors");
    const paymentCollection = client.db("doctors_portal").collection("payment");
    console.log("db connected");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden access" });
      }
    };

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user?.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params?.email;
      const filter = { email: email };
      const updatedUser = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updatedUser);
      res.send(result);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params?.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedUser = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedUser,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, accessToken: token });
    });

    // WARNING:
    // This is not the way to query
    // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date || "May 14, 2022";

      // step 1: get all service
      const services = await serviceCollection.find().toArray();
      // step 2: get the booking of that day . output: [{}, {}, {}, {}]
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

    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    app.patch("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const query = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const result = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(
        query,
        updatedDoc
      );
      res.send(updatedBooking);
    });

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req?.query?.patient;
      const decodedEmail = req.decoded?.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const result = await bookingCollection.find(query).toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
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
        // console.log('sending email')
        // sendAppointmentEmail(booking);
        res.send({ success: true, result });
      }
    });

    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await doctorCollection.find().toArray();
      res.send(result);
    });

    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params?.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
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
 * app.put('/booking/id') upsert ==> update if(exist) or insert if(!exist)
 * app.delete('/booking/id') delete one in most of the case
 */
