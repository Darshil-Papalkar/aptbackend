const { Client } = require("pg");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const Razorpay = require("razorpay");
const upload = multer({ dest: "uploads/" });
const prescriptionUpload = multer({ dest: "prescriptions/" });
const { uploadFile, deleteFile } = require("./s3");
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcryptjs');
const { check, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');

const app = express();

app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cors());
sgMail.setApiKey(process.env.SENDGRID_API_KEY);


// mail client
const sendMail = async (to,text,template)=>{
  const msg = {
    to, // Change to your recipient
    from: 'info@aptdiagnostics.com', // Change to your verified sender
    subject: 'Sending with SendGrid is Fun',
    text,
    html:template,
  }

  sgMail.send(msg).then(() => {console.log('Email sent')}).catch((error) => {console.error(error)})

}

// db client
const client = new Client({
  user: process.env.DB_CLIENT_USER,
  host: process.env.DB_CLIENT_HOST,
  database: process.env.DB_CLIENT_DATABASE,
  password: process.env.DB_CLIENT_PASSWORD,
  port: 5432,
});

client.connect();

// sms client
const smsClient={
  sendOTP : async () => {
      const result = await axios.post("http://api.pinnacle.in/index.php/sms/json");
  }

}

// payment gateway client
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEYID,
  key_secret: process.env.RAZORPAY_KEYSECRET
});

app.post("/makePaymentRazorpay", async (req, res) => {
  try{  
    // console.log(req.body);
    const currency = "INR";
    const amount = req.body.amount * 100;
    const response = await razorpay.orders.create({amount, currency});
    // console.log(response.data);
    res.send(response).status(200);
  }
  catch(err){
    console.log(err);
    console.log("helloo payment error occured");
    res.sendStatus(500);
  }
});

app.post("/confirmGiftPayment",async(req,res)=>{
  try{
    const result = await client.query(`INSERT INTO "aptgifts" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
      req.body.userName,
      req.body.userEmail,
      req.body.userContact,
      req.body.recieverName,
      req.body.recieverContact,
      req.body.recieverEmail,
      req.body.couponCode,
      req.body.couponAmount,
      req.body.giftedTestList
    ]);

    res.json({
      code:200,
      data:"",
    })

  }catch(err){
    console.log(err)
    res.json({
      code:500,
      data:"",
    })
  }
})

app.post("/addSubscriber", [
      check("email").isEmail(),
      check("name").not().isEmpty()
    ],
      async (req, res) => {
        try{
          const errors = validationResult(req);
        
          if(!errors.isEmpty()){
            return res.status(400).json({message: errors, code: 400});
          }
          const email = req.body.email;

          const checkExist = await client.query(`SELECT * FROM "aptsubscribers" WHERE "email" = $1`, [email]);
          
          if(checkExist.rows.length > 0){
            return res.status(200).json({code: 200, message: "Already Subscribed!"});
          }
          else{
            const response = await client.query(`INSERT INTO "aptsubscribers" ("email", "name", "dateTime") 
              VALUES ($1, $2, $3)`, [email, req.body.name, new Date()]);
            if(response.rowCount >= 1)
              res.status(201).json({message: "Successfully Subscribed!", code: 201});
            else{
              res.status(500).json({message: "Sever Issue, please try again later!", code: 500});
            }
          }
        }
        catch(err){
          console.log(err);
          res.status(500).json({message: "Sever Issue, please try again later!", code: 500});
        }
});

const checks = {
  userExists: async (contact) => {
    try {
      const result = await client.query(
        `SELECT "userId" FROM apttestuser WHERE contact = $1`,
        [contact]
      );
      return result.rows.length;
    } catch (e) {
      console.log(e);
      return "failed";
    }
  },
};

const communication = {
  sendReportsMail: async (to, testName) => {
    const mailOptions = {
      from: "ayushpayasi@gmail.com",
      to: `${to}`,
      subject: `Welcome to APT Diagnostics ${testName}`,
      html: `<p>Welcome ${testName}</p>`,
    };

    await transporter.sendMail(mailOptions, (err, info) => {
      if (err) console.log(err);
      else console.log(info);
    });
  },
  sendOTP: async (to, testName) => {},
};

const liveHealthApiRequest = {
  labAppointment: async (data) => {
    const headers = {
      "Content-Type": "application/json",
    };
    try {
      const response = await axios.post(
        `https://staging.livehealth.solutions/LHRegisterBillAPI/${process.env.LIVE_HEALTH_TOKEN}/`, 
        data, 
        { headers: headers}
      );
      return { code: "200", data: response.data };
    } 
    catch (err) {
      console.log(err);
      return { code: "400", data: err };
    }
  },
  homeAppointment: async (data) => {
    const headers = {
      "Content-Type": "application/json",
    };
    try {
      const response = await axios.post(
        `https://staging.livehealth.solutions/LHRegisterBillAPI/${process.env.LIVE_HEALTH_TOKEN}/`,
        data,
        {headers: headers}
      );
      return { code: "200", data: response.data };
    } 
    catch (err) {
      console.log(err);
      return { code: "400", data: err };
    }
  },
};

const localDatabaseRequest = {
  createNewUser: async (body) => {
    try {
      const response = await client.query(
        `INSERT INTO "apttestuser" ("contact") VALUES ($1)`,
        [body["mobile"]]
      );
      return true;
    } catch (err) {
      return false;
    }
  },
  getList: async (body) => {
    try {
      const response = await client.query(
        `SELECT "billList","appointmentList","reportList" FROM "apttestuser" WHERE "contact" = ($1) ;`,
        [body["mobile"]]
      );
      if (response.rows.length) {
        return { ...response.rows[0], contains: 1 };
      } else {
        return { contains: 0 };
      }
    } catch (e) {
      return { ...e, contains: 0 };
    }
  },
  updateUserInfo: async (body, billList) => {
    try {
      if ("billId" in body) {
        billList.push(body["billId"]);
      }
      const response = await client.query(
        `UPDATE "apttestuser" SET "userName" = ($1), "age" = ($2), "billlist" = ($3) WHERE "contact" = ($4) ;`,
        [body["fullName"], body["age"], billList, body["mobile"]]
      );
    } catch (err) {
      console.log(err);
    }
  },
};

app.post("/userCheck", async (req, res) => {
  if (await checks.userExists(req.body["mobile"])) {
    res.send("exists").status(200);
  } else {
    res.send("Do not exists").status(404);
  }
});

app.post("/createNewUser", async (req, res) => {
  // if (await localDatabaseRequest.createNewUser(req.body)){
  res.send("new User Creted").status(201);
  // }
  // else{
  // res.send("failed to create new user").status(500)
  // }
});

// unchecked
app.post("/updateUser", async (req, res) => {
  try {
    var billList = [];
    var appointmentList = [];
    var reportList = [];

    const list = await localDatabaseRequest.getList(req.body);
    if (list.contains) {
      billList = list.billList;
      appointmentList = list.appointmentList;
      reportList = list.reportList;
    }
    // address may not be present perform check
    const isUpdated = await client.query(
      `UPDATE "apttestuser" SET "dob" = $1,  "email" = $2 , "gender" = $3 , "address" = $4 , "city" = $5 , "pincode" = $6, "billList" = $7 , "reportList" = $8 ,"appointmentList" = $9, "userName" = $10 WHERE "contact" = $11 `,
      [
        req.body["dob"],
        req.body["email"],
        req.body["gender"],
        req.body["area"],
        req.body["city"],
        req.body["pincode"],
        billList,
        reportList,
        appointmentList,
        req.body["fullName"],
        req.body["mobile"],
      ]
    );
  } catch (err) {
    console.log(err);
    res.send("internal server error").status(500);
  }
});



app.post("/createAppointment/lab", async (req, res) => {
  const localSaveBody = {
    contact: req.body["mobile"],
    testName: req.body["fullName"],
    email: req.body["email"],
    age: req.body["age"],
    gender: req.body["gender"],
    area: req.body["area"],
    city: req.body["city"],
    pincode: req.body["pincode"],
  };

  if (await checks.userExists(req.body["mobile"])) {
    const billList = await localDatabaseRequest.getBillList(req.body["mobile"]);
    const response = await liveHealthApiRequest.labAppointment(req.body);
    if (response.code === "200") {
      const billId = response.data["billId"];
    } else {
      res.send("failed to book Appointment!").status(400);
    }

    localDatabaseRequest.updateUserInfo();
  } else {
  }
});

app.get("/priceList", async (req, res) => {
  try {
    const response = await axios.get(
      `https://staging.livehealth.solutions/getAllTestsAndProfiles/?token=${process.env.LIVE_HEALTH_TOKEN}`
    );
    const coupon = req.query.coupon;
    switch (coupon) {
      case "AYUSH":
        let test = [];
        response.data["testList"].forEach((item) => {
          let temp = item;
          temp.testAmount =
            parseFloat(item.testAmount) - parseFloat(item.testAmount) * 0.2;
          test.push(temp);
        });
        res.json([{ code: 200 }, test]);
        break;

      case "ANCHIT":
        let test2 = [];
        response.data["testList"].forEach((item) => {
          let temp = item;
          temp.testAmount =
            parseFloat(item.testAmount) - parseFloat(item.testAmount) * 0.5;
          test2.push(temp);
        });
        res.json([{ code: 200 }, test2]);
        break;

      case "4664684":
        response.data["profileTestList"].forEach((item) => {
          if (item.testID == 4664684) {
            res.json([{ code: 200 }, item["testList"]]);
          }
        });
        res.send(400);
        break;
      case "GYMFREAK":
        res.json([{ code: 200 }, response.data["testList"]]);
        break;
      default:
        res.json([{ code: 200 }, { ...response.data["testList"] }]);
        break;
    }
  } catch (err) {
    console.log(err);
    res.send("failed").status(200);
  }
});

app.post("/check", async (req, res) => {
  try {
    const billList = [];
    const reportList = [];
    const appointmentList = [];

    res.send("success").status(200);
  } catch (err) {
    console.log(err);
    res.send("failed").status(400);
  }
});

app.post("/bookLabAppointment", async (req, res) => {
  try {
    if (await checkUser(req.body["mobile"])) {
      const result = await liveHealthApiCall.labAppointment(req.body);
      if (result.code === "200") {
        res.code(200);
      } else {
        res.code(400);
      }
    } else {
      client.query("INSERT INTO apttestuser () VALUES ()");
    }
  } catch (e) {
    console.log(e);
    res
      .send("there is a problem in processing request at this time")
      .status(500);
  }
});

// sms welcome user

const welcomeNewUser = async (data) => {
  console.log("generating welcome user sms");
  try{
    const message = `Hi ${data.fullName}, Welcome to APT Diagnostics. We wish you and your near ones a very happy and healthy life.
Do not forget to wear mask and maintain social distancing.
- APT Diagnostics`;
  
  await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${data.mobile}&tempid=${process.env.SMS_CLIENT_WELCOME_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
  .then(response => {/*console.log(response.data);*/ return true;})
  .catch(err => {console.log("An Error Occured - " + err); return false;});
  }
  catch(err){
    console.log(err);
    return false;
  }
};

// sms home collection new user

const homeCollectionNewUser = async (data) => {
  console.log("generating Home collection new user sms");
  try{
    const us = 'us';
    const temp = (data.slotDate.split('T'));
    const date = (temp[0]).toString();
    const time1 = (temp[1]).toString().slice(0, 5);
    const time2 = (parseInt(temp[1].slice(0, 2))+1).toString() + temp[1].slice(2, 5);
    // console.log(time[2]);
    // console.log(time);

    const message = `You have been registered with ${us} and your home collection request has been booked and confirmed on ${date} between ${time1} to ${time2}.
  - APT Diagnostics`
  
    await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${data.mobile}&tempid=${process.env.SMS_CLIENT_HOME_COLLECTION_NEWUSER_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
    .then(response => {/*console.log(response.data);*/ return true;})
    .catch(err => {console.log("An Error Occured - " + err); return false;});
  }
  catch(err){
    console.log(err);
    return false;
  }

};

// sms home collection existing user

const homeCollectionExistingUser = async (data) => {
  console.log("generating Home collection existing user sms");
  try{
    const us = 'us';
    const temp = (data.slotDate.split('T'));
    const date = (temp[0]).toString();
    const time1 = (temp[1]).toString().slice(0, 5);
    const time2 = (parseInt(temp[1].slice(0, 2))+1).toString() + temp[1].slice(2, 5);
    // console.log(time1);
    // console.log(time2);

    const message = `Hi ${data.fullName},

Your home collection request with ${us} has been booked and confirmed on ${date} between ${time1} to ${time2}.
    
- APT Diagnostics`
  
    await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${data.mobile}&tempid=${process.env.SMS_CLIENT_HOME_COLLECTION_EXISTINGUSER_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
    .then(response => {/*console.log(response.data);*/ return true;})
    .catch(err => {console.log("An Error Occured - " + err); return false;});
  }
  catch(err){
    console.log(err);
    return false;
  }

}

// sms user booking successful

const successfulUserBooking = async (data) => {
  console.log("generating successful user booking sms");
  try{
    const user = 'us';
    const date = (data.slotDate.split('T')[0]).toString();

    const message = `Hi ${data.fullName},
Your appointment has been booked successfully with ${user} on ${date} at ${(data.slotTime).split(' ')[1]}.

- APT Diagnostics`;

  await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${data.mobile}&tempid=${process.env.SMS_CLIENT_APPOINTMENT_BOOKED_TEMPLATE}&message=${message}&response=Y&messagetype=TXT`)
  .then(response => {/*console.log(response.data);*/ return true;})
  .catch(err => {console.log("An Error Occured - " + err); return false;});

  }
  catch(err){
    console.log(err);
    return false;
  }
};

// sms new bill id

const billID = async (data, id) => {
  console.log("generating bill sms");
  try{
    // console.log(id);
    const here = 'https://www.google.com/'
    const message = `Hi ${data.fullName}, Your Bill ID is ${id}. Please use this Bill ID to download the reports with a single click from ${here}.

APT Diagnostics`;

  await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${data.mobile}&tempid=${process.env.SMS_CLIENT_BILL_ID_TEMPLATE}&message=${message}&response=Y&messagetype=TXT`)
  .then(response => {/*console.log(response.data);*/ return true;})
  .catch(err => {console.log("An Error Occured - " + err); return false;});

  }
  catch(err){
    console.log(err);
    return false;
  }
}

//booking utilities

const checkUserExist = async (data) => {
  const response = await client.query(`SELECT * FROM "apttestuser" WHERE 
  "contact" = $1 ;`, [data.mobile]);
  return response.rows[0];
}

const createNewUser = async (data) => {
  // console.log("New User Data - ", data);
  const passdate = new Date(data.dob).getFullYear();
  let password = /^\S*/i.exec(data.fullName)[0].toLowerCase() + passdate;
  password = await bcrypt.hash(password.toString(), parseInt(process.env.PASS_CLIENT_HASH_SALT));
  const response = await client.query(`INSERT INTO "apttestuser" 
                                          ("userName", "dob", "email", "gender", "appointmentList", "billList", "contact", 
                                          "address", "userPassword", "reportList", "couponsUsed", "age", "prefix") 
                                          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,[
    data.fullName, data.dob, data.email, data.gender, data.appointmentList, data.billList,
    data.mobile, data.area, password, data.reportList, data.couponsUsed, data.age, data.prefix
  ]);
  await welcomeNewUser(data);
  return response.rowCount === 1;
}

const updateExistingUser = async (data) => {
  // console.log("Existing User Data - ", data);
  const response = await client.query(`UPDATE "apttestuser" SET "appointmentList" = $1 ,"billList" = $2, "reportList" = $3, 
                                      "couponsUsed" = $4, "age" = $5, "gender" = $6, "email" = $7, "address" = $8, "prefix" = $9
                                      WHERE "contact" = $10`,[
    data.appointmentList, data.billList, data.reportList, data.couponsUsed,
    data.age, data.gender, data.email, data.address, data.prefix, data.mobile
  ]);
  return response.rowCount === 1;
}


const createNewUser2 = async (data) => {
  const passdate = new Date(data.dob).getFullYear();
  let password = /^\S*/i.exec(data.fullName)[0].toLowerCase() + passdate;
  password = await bcrypt.hash(password.toString(), parseInt(process.env.PASS_CLIENT_HASH_SALT));
  const response = await client.query(`INSERT INTO "apttestuser" (
    "userName", "userPassword", "dob", "email", "gender", "address", "appointmentList",
    "billList", "reportList", "contact", "familyId", "couponsUsed", "age", "prefix"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning 
    "userId", "userName", "dob", "email", "gender", "address", 
    "appointmentList", "billList", "reportList", "contact", "familyId", "couponsUsed", "age", "prefix";`,[
      data.fullName,
      password,
      data.dob,
      data.email,
      data.gender,
      data.area,
      [], [], [],
      data.mobile,
      null,
      [],
      data.age,
      data.prefix
    ]
  );

  await welcomeNewUser(data);
  return response.rows[0];
};

const updateExistingUser2 = async (data) => {
  const response = await client.query(`UPDATE "apttestuser" SET "appointmentList" = $1 ,"billList" = $2, "reportList" = $3, 
                                      "couponsUsed" = $4 WHERE "contact" = $5`,[
    data.appointmentList,
    data.billList,
    data.reportList,
    data.couponsUsed,
    data.mobile
  ]);

  return response.rows[0];
}

const findUserByFamilyId = async (data)=>{
  const result = await client.query(`SELECT * FROM "apttestuser" WHERE "familyId" = $1`,[data.familyId])
  return result.rows[0]
}

const isFamilyMemberExist = async (data) => {
  const result = await client.query(`SELECT * FROM "memberslist" WHERE "familyId" = $1 AND "userName" = $2`,[
    data.familyId,
    data.fullName
  ]);
  return result.rowCount === 1;

}

const createFamilyMember = async (data) => {
  // console.log("Create Family Member - " , data);
  const result = await client.query(`INSERT INTO "memberslist" 
                              ("userName" , "dob" , "address" , "gender" , "familyId", "email", "mobile", "prefix", "age") 
                              VALUES ($1 ,$2 ,$3 ,$4, $5, $6, $7, $8, $9)`,[
    data.fullName.trim(),
    data.dob,
    data.area,
    data.gender,
    data.familyId,
    data.email,
    data.mobile,
    data.prefix,
    data.age
  ]);
  return result.rowCount === 1;
}

const updateFamilyMember = async (data) => {

  // console.log("Update Family Member - " , data);
  const result = await client.query(`UPDATE "memberslist" SET "address" = $1, "gender" = $2, "email" = $3, "mobile" = $4,
                                    "prefix" = $5, "age" = $6 WHERE "mobile" = $7 AND "familyId" = $8`,[
    data.area,
    data.gender,
    data.email,
    data.mobile,
    data.prefix,
    data.age,
    data.mobile,
    data.familyId
  ]);
  return result.rowCount == 1;
}

// -------------- sms -------------------

// prescription otp verification

app.get("/prescriptionOtp", async (req, res, next) => {
  try{
    const mobile = req.query.mobile;
    if(mobile.length !== 10){
      throw {message: "Invalid mobile number", code: 400, otp: null, mobile: mobile};
    }
    else{
      let otp = (Math.floor(Math.random()*10000)) + 5000;
      const message = `Your verification OTP is ${otp}
APT Diagnostics`;
      otp = await bcrypt.hash(otp.toString(), parseInt(process.env.SMS_CLIENT_HASH_SALT));
      await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${mobile}&tempid=${process.env.SMS_CLIENT_PRESCRIPTION_OTP_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
          .then(response => {res.json({message: response.data, code: 200, otp: otp, mobile: mobile})})
          .catch(err => {console.log(err); res.json({message: "Something went wrong", code: 500, otp: null, mobile: mobile})});
    }
  }
  catch(err){
    res.json({message: err.message, code: err.code, otp: err.otp, mobile: err.mobile});
  }
})

// booking otp verification

app.get('/bookingVerification', async (req, res, next) => {

  try{
    const mobile = req.query.mobile;
    if(mobile.length !== 10) {
      res.status(400).json({isValidPhone: false});
    }
    else{
      let otp = Math.floor(Math.random()*10000) + 5000;
      const message = `Hi, Your OTP for number verification is ${otp}
      
APT Diagnostics`;
    otp = await bcrypt.hash(otp.toString(), parseInt(process.env.SMS_CLIENT_HASH_SALT));
    await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${mobile}&tempid=${process.env.SMS_CLIENT_OTP_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
          .then(response => res.status(200).json({result: response.data, codeData: otp, mobile: mobile, isValidPhone: true}))
          .catch(err => {console.log("An Error Occured - " + err), res.status(400).json()});
    }
  }
  catch(err){
    res.status(401).send('Something Went Wrong' + err);
  }
});

// bookings APIs

app.post("/saveBeforeBooking",async(req,res)=>{
  try{
    const userData = await checkUserExist(req.body)
    if(userData !== undefined) //user exist
    {
      let billList = userData.billList
      let appointmentList = userData.appointmentList
      const data = {
        appointmentList,
        billList,
        mobile:req.body.mobile
      }

      const result = await updateExistingUser2(data)
        if(result !== undefined){res.json({code:"200",data:result})}
        else{res.json({code:"500"})}
    }
    else //user not exist
    {
      const data = {
        "mobile": req.body.mobile,
        "email": req.body.email,
        "fullName": req.body.fullName,
        "gender": req.body.gender,
        "area": req.body.area,
        "dob": req.body.dob,
        "billList":[],
        "appointmentList":[]
      }

      const result = await createNewUser2(data)
      if(result !== undefined){res.json({code:"200",data:result})}
      else{res.json({code:"500"})}
    }


  }catch(err){
    console.log(err);
    res.json({message:"internal server error!",code:"500"})
  }
});


app.post("/bookAppointment/lab", async (req, res) => {
    try{
      // console.log(req.body.data);

      let newBillId = "";
      let newAppointmentId = "";
      let newReportDetails = [];

      const liveHealthResponse = await liveHealthApiRequest.labAppointment(req.body.data);
      // console.log(liveHealthResponse.response);
      if(liveHealthResponse.code === "200"){
        newBillId = liveHealthResponse.data.billId;
        newAppointmentId = liveHealthResponse.data.appointmentId;
        newReportDetails.push(...(liveHealthResponse.data.reportDetails.map(item => item.testID)));
      }
      else{
        console.log("________live health api error____________");
        throw {code: 500, message: "Error in livehealth api!"};
      }
      
      if(req.body.supportingData.isMember){ // is family member
        // console.log("Is family member");
        if(await isFamilyMemberExist(req.body.supportingData)){
          await updateFamilyMember(req.body.supportingData);
        }
        else{
          await createFamilyMember(req.body.supportingData);
        }
         // is not a family member
      }

      // console.log("Normal Member");

      const userData = await checkUserExist(req.body.supportingData);
      if(userData !== undefined) //user exist
      {
        let billList = userData.billList;
        let appointmentList = userData.appointmentList;
        let reportList = userData.reportList;
        let reportData = [];
        let couponsUsed = userData.couponsUsed.length ? userData.couponsUsed : [];

        reportList.map(item => {
          reportData.push(JSON.parse(item));
        });

        couponsUsed.push(req.body.supportingData.coupon);
        billList.push(newBillId);
        appointmentList.push(newAppointmentId);
        newReportDetails.push(...reportData);

        const data2 = {
          appointmentList,
          billList,
          reportList: newReportDetails,
          mobile: req.body.data.mobile,
          couponsUsed : req.body.supportingData.isMember ? [] : couponsUsed,
          age : req.body.supportingData.age,
          gender : req.body.supportingData.gender,
          email : req.body.supportingData.email,
          address : req.body.supportingData.area,
          prefix : req.body.supportingData.prefix
        };

        if(await updateExistingUser(data2)){
          if(await setSlot(req.body.supportingData)){

            await successfulUserBooking(req.body.supportingData);
            // await billID(req.body.supportingData, newBillId);
            throw {code:200, message: "Existing user updated and slot booked"};
          }
          else{
            throw {code: 400, message: "Existing user updated! but slot booking failed"};
          }
        }
        else{
          throw {code:500, message: "Can't update existing user!"};
        }
      } 
      else //user not exist
      {
        const data2 = {
          "mobile": req.body.supportingData.mobile,
          "email": req.body.supportingData.email,
          "fullName": req.body.supportingData.fullName,
          "gender": req.body.supportingData.gender,
          "area": req.body.supportingData.area,
          "dob": req.body.supportingData.dob,
          "billList": [newBillId],
          "appointmentList": [newAppointmentId],
          "reportList": newReportDetails,
          "couponsUsed": [req.body.supportingData.coupon],
          "age": req.body.supportingData.age,
          "prefix": req.body.supportingData.prefix
        };

        if(await createNewUser(data2)){
          if(await setSlot(req.body.supportingData)){

            await successfulUserBooking(req.body.supportingData);
            // await billID(req.body.supportingData, newBillId);
            throw {code:200, message:"User Created with successful slot booking!"};
          }
          else{
            throw {code: 400, message: "User created but slot booking failed"};
          }
        }
        else{
          throw {code:500, message:"Can't create new user!"};
        }
      }
    }
    catch(err){
      console.log(err);
      res.json({code: err.code, message: err.message});
    }
});


app.post("/bookAppointment/home", async (req, res) => {
  try{

    let newBillId = "";
    let newAppointmentId = "" ;
    let newReportDetails = [];

    const liveHealthResponse = await liveHealthApiRequest.homeAppointment(req.body.data);
    
    if(liveHealthResponse.code === "200"){
      newBillId = liveHealthResponse.data.billId;
      newAppointmentId = liveHealthResponse.data['homecollection ID'];
      newReportDetails.push(...(liveHealthResponse.data.reportDetails.map(item => item.testID)));
    }
    else{
      console.log("________live health api error____________");
      throw {code: 500, message: "Error in livehealth api!"};
    }

    if(req.body.supportingData.isMember){
      if(await isFamilyMemberExist(req.body.supportingData)){
        await updateFamilyMember(req.body.supportingData);
      }
      else{
        await createFamilyMember(req.body.supportingData);
      }
    }
    
    const userData = await checkUserExist(req.body.supportingData);

    if(userData !== undefined) //user exist
    {
      let billList = userData.billList;
      let appointmentList = userData.appointmentList;
      let reportList = userData.reportList;
      let reportData = [];
      let couponsUsed = userData.couponsUsed.length ? userData.couponsUsed : [];

      reportList.map(item => {
        reportData.push(JSON.parse(item));
      });

      couponsUsed.push(req.body.supportingData.coupon);
      billList.push(newBillId);
      appointmentList.push(newAppointmentId);
      newReportDetails.push(...reportData);

      const data2 = {
        appointmentList,
        billList,
        reportList: newReportDetails,
        mobile: req.body.data.mobile,
        couponsUsed : req.body.supportingData.isMember ? [] : couponsUsed,
        age : req.body.supportingData.age,
        gender : req.body.supportingData.gender,
        email : req.body.supportingData.email,
        address : req.body.supportingData.area,
        prefix : req.body.supportingData.prefix
      };

      if(await updateExistingUser(data2)){
        if(await setSlot(req.body.supportingData)){
          
            await homeCollectionExistingUser(req.body.supportingData);
            // await billID(req.body.supportingData, newBillId);
            throw {code: 200, message: "Existing User updated and slot booked!"};
        }
        else{
          throw {code: 400, message: "Existing User updated! but slot booking failed"};
        }
      }
      else{
        throw {code: 500, message: "Can't update existing user!"}; 
      }
    } 
    else //user not exist
    {
      const data2 = {
        "mobile": req.body.supportingData.mobile,
        "email": req.body.supportingData.email,
        "fullName": req.body.supportingData.fullName,
        "gender": req.body.supportingData.gender,
        "area": req.body.supportingData.area,
        "dob": req.body.supportingData.dob,
        "billList":[newBillId],
        "appointmentList":[newAppointmentId],
        "reportList": newReportDetails,
        "couponsUsed": [req.body.supportingData.couponsUsed],
        "age": req.body.supportingData.age,
        "prefix": req.body.supportingData.prefix
      };

      if(await createNewUser(data2)){
        if(await setSlot(req.body.supportingData)){

            await homeCollectionNewUser(req.body.supportingData);
            // await billID(req.body.supportingData, newBillId);
            throw {code: 200, message: "user created with successful slot booking!"};
        }
        else{
          throw {code: 400, message: "User Created but slot booking failed!"};
        }
      }
      else{
        throw {code: 500, message: "Can't create new user!"};
      }
    }
  }
  catch(err){
    console.log(err);
    res.json({code: err.code, message: err.message});
  }
});

const checkLoginPass =  async (clientPass, dbPass) => {
  const isValid = await bcrypt.compare(clientPass, dbPass);
  return isValid;
};

app.post("/login", [
      check("mobile").isNumeric().isLength({min: 10, max: 10}),
      check("password").isLength({min: 8})
    ], 
    async (req, res) => {
  try {
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.status(400).json({code: 400, data: errors, message: 
      "Invalid Values Passed!"});
    }
    const userCheck = await checkUserExist(req.body);
    if(userCheck === undefined){
      return res.status(200).json({code: 404, data: null, 
        message: "User Doesn't Exists"});
    }
    else if(!(await checkLoginPass(req.body.password, userCheck.userPassword))){
      // console.log("Wrong Credentails");
      return res.status(200).json({code: 400, message: "Invalid Credentials Entered!",
        data: null
      });
    }
    else{
      delete userCheck.userPassword;
      res.status(200).json({code: 200, message: "LoggedIn Successful", data: userCheck});
    }
  } 
  catch (e) {
    console.log(e);
    res.status(500).json({code: 500, message: "Internal Server Issue", data: null});
  }
});

app.post("/register", [
    check("mobile").isNumeric().isLength({min: 10, max: 10}),
    check("fullName").not().isEmpty(),
    check("gender").not().isEmpty(),
    check("area").not().isEmpty(),
    check("dob").isDate(),
    check("age").isNumeric().notEmpty(),
    check("prefix").not().isEmpty()
  ],
  async (req, res) => {
  try{
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      console.log(errors);
      return res.status(400).json({code: 400, message: "Invalid Values Passed", 
        errors});
    }
    else{
      const userExist = await checkUserExist(req.body);
      // console.log(userExist);
      if(userExist === undefined){
        const result = await createNewUser2(req.body);
        // console.log(result);
        if(result !== undefined){
          res.status(201).json({code: 201, data: result, 
            message: "User Registered Successfully"});
        }
        else{
          res.status(400).json({code: 400, data: null,
            message: "User Creation Failed"});
        }
      }
      else{
        delete userExist.userPassword;
        res.status(202).json({code: 202, data: userExist, 
          message: "User Already Exists, please Login"});
      }
    }
  }
  catch(err){
    console.log(err);
    res.status(500).json({code: 500, data: null, message: "Internal Server Issue"});
  }
})

app.post("/getMemberDetails", [
    check("familyId").not().isEmpty()
  ], async(req, res) => {
  try{
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.json({code: 404, message: "Missing/Invalid Family Id"});
    }
    const result = await client.query(`SELECT * FROM "memberslist" WHERE "familyId" = $1`, [req.body.familyId]);
    if(result.rowCount>0){
    res.json({code:200,data:result.rows})}
    else{
      res.json({code:202,data:result.rows})
    }
  }catch(err)
  {console.log(err);res.json({code:500,data:err})}
})


// DO NOT CHANGE
app.post("/storeReport", async (req, res) => {
  try {
    const result = await client.query(
      "INSERT INTO apttestreports VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        req.body["CentreReportId"],
        req.body["labId"],
        req.body["billId"],
        req.body["dictionaryId"],
        req.body["Report Id"],
        req.body["reportDate"],
        req.body["Patient Id"],
        req.body["labReportId"],
        req.body["Contact No"],
        req.body["testID"],
        req.body["reportBase64"],
      ]
    );
    // console.log(result)
    res.status(200).send("successful");
  } catch (e) {
    console.log(e);
    res.status(400).send("failed");
  }
});


app.get("/getReport", async (req, res) => {
  try {
    const result = await client.query(
      "SELECT * FROM apttestreports WHERE contact = $1",
      [req.query.contact]
    );
    res.json(result.rows);
  } catch (e) {
    console.log(e);
    res.status(400).send("failed");
  }
});

//newly created for blog section
app.get("/getAllBlogs", async (req, res) => {
  try {
    const resultData = await client.query(
      `SELECT * FROM "aptblogs"  ORDER BY "blogId"`
    );
    if (resultData.rows.length > 0) {
      res.status(200).json({ data: resultData.rows});
    } else {
      res.send("Not Fetched");
    }
  } catch (err) {
    console.log(err);
    res.status(400).send("failed");
  }
});

// admin panel

const checkPass = async (dbpass, pass) =>{
  const isValid = await bcrypt.compare(pass, dbpass);
  return (isValid);
}

app.post('/admin/validate', [
      check("email").isEmail(),
      check("password").isLength({min: 8})
    ], async(req, res) => {
      try{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
          return res.status(400).json({code: 400, message: "Invalid Credentials"});
        }

        const adminDetails = await client.query(`SELECT * FROM "aptadmin" `);
        const email = adminDetails.rows[0].email;
        const pass = adminDetails.rows[0].password;
        const isValid = await checkPass(pass, req.body.password);
        // console.log(email, pass, isValid);

        if(email !== req.body.email || !isValid){
          return res.status(400).json({code: 400, message: "Invalid Credentials"});
        }
        else{
          const token = jwt.sign(
            {email},
            process.env.JSON_TOKEN_KEY,
            {expiresIn: '1h'}
          );
          return res.status(200).json({
                                code: 200, 
                                message: "LoggedIn Successful",
                                email,
                                token
                              });
        }
      }
      catch(err){
        console.log(err);
        res.status(500).json({code: 500, message: "Internal Server Issue"});
      }
});

app.post('/admin/mobileOtp', [
      check("mobile").isNumeric().isLength({min: 10, max: 10})
    ], async (req, res) => {
      try{
        
        const errors = validationResult(req);
        if(!errors.isEmpty()){
          return res.status(400).json({code: 400, errors, isValidPhone: false, message: "Invalid Contact Number"});
        }

        const adminDetails = await client.query(`SELECT ("mobile") FROM "aptadmin"`);
        // console.log(adminDetails.rows[0].mobile);
        // console.log(req.body.mobile);

        if(req.body.mobile === adminDetails.rows[0].mobile){
          // console.log("same mobile");
          let otp = Math.floor(Math.random()*10000) + 5000;
          const message = `Hi, Your OTP for number verification is ${otp}
          
APT Diagnostics`;
          otp = await bcrypt.hash(otp.toString(), parseInt(process.env.SMS_CLIENT_HASH_SALT));
          await axios(`http://www.smsjust.com/sms/user/urlsms.php?username=${process.env.SMS_CLIENT_USERNAME}&pass=${process.env.SMS_CLIENT_PASS}&senderid=${process.env.SMS_CLIENT_SENDERID}&dest_mobileno=91${req.body.mobile}&tempid=${process.env.SMS_CLIENT_OTP_TEMPLATE_ID}&message=${message}&response=Y&messagetype=TXT`)
                .then(response => res.status(200).json({code: 200, result: response.data, codeData: otp, mobile: req.body.mobile, isValidPhone: true, message: "Otp sent successfully"}))
                .catch(err => {console.log("An Error Occured - " + err), res.status(400).json({code: 400, isValidPhone: false, message: "Internal Server Issue"})});
        }
        else{
          // console.log("not same mobile");
          res.status(400).json({code: 400, isValidPhone: false, message: "Contact Number not matched!"});
          // return res.status(400).json({code: 400, errors, isValidPhone: false, message: "Invalid Contact Number"});
        }
      }
      catch(err){
        console.log(err);
        res.status(401).json({code: 401, message: "Internal Server Issue"});
      }
});

app.post('/admin/updatePassword', [
      check('password').not().isEmpty()
    ], async (req, res) => {
      try{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
          return res.status(400).json({code: 400, errors, message: "Enter Password of length 8 or more"});
        }

        const data = await client.query(`UPDATE "aptadmin" SET "password" = $1`, [req.body.password]);
        
        if(data.rowCount > 0){
          res.status(200).json({code: 200, message: "Password updated successfully"});
        }
        else{
          res.status(500).json({code: 500, message: "Couldn't Update Password"});
        }
      }
      catch(err){
        console.log(err);
        res.status(500).json({code: 500, message: "Internal Server Issue"});
      }
    }
);

app.get("/admin/dialogueBoxCheck", async (req, res) => {
  try {
    const result = await client.query(
      `SELECT * FROM "aptpackages" WHERE "testID" = $1`,
      [req.query.Id]
    );
    if (result.rows.length === 0) {
      const packageList = await axios.get(
        `https://staging.livehealth.solutions/getAllTestsAndProfiles/?token=${process.env.LIVE_HEALTH_TOKEN}`
      );
      const tempDict = await packageList.data.profileTestList.filter(
        (item) => item.testID == req.query.Id
      );
      if (tempDict.length === 0) {
        res.json({ status: 400, body: [] });
      } else {
        console.log(tempDict[0].integrationCode)
        let finalDict = {
          type: tempDict[0].integrationCode,
          testName: tempDict[0].testName,
          description: "",
          testAmount: tempDict[0].testAmount,
          testsIncluded: tempDict[0].testList.map((item) => item.testName),
          preRequisites: [],
          idealFor: [],
          testID: tempDict[0].testID,
          isSpecial: false,
        };
        res.json({ status: 200, body: finalDict });
      }
    } else {
      res.json({ status: 200, body: result.rows[0] });
    }
  } catch (e) {
    console.log(e);
    res.json({ status: 500 });
  }
});

app.get("/admin/getPackageByType", async (req, res) => {
  const result = await client.query(
    `SELECT * FROM "aptpackages" WHERE type = $1`,
    [req.query.type]
  );
  res.json(result.rows);
});

app.get("/admin/getPackageById", async (req, res) => {
  const result = await client.query(
    `SELECT * FROM "aptpackages" WHERE "testID" = $1`,
    [req.query.Id]
  );
  res.json(result.rows);
});

app.get("/admin/getLiveHealthPackages", async (req, res) => {
  try{
    const result = await axios(`https://staging.livehealth.solutions/getAllTestsAndProfiles/?token=${process.env.LIVE_HEALTH_TOKEN}`);
    const data = result.data;
    res.json({data}).status(200);
  }
  catch(err){
    console.log(err);
    res.json({err}).status(500);
  }
});

app.get("/admin/getAllPackage", async (req, res) => {
  try {
    const result = await client.query(
      `SELECT * FROM "aptpackages" ORDER BY "packageID"`
    );
    res.status(200).json(result.rows);
  } catch (e) {
    res.send("Internal Server Error").status(500);
  }
});

app.post("/admin/postPackage", 
          upload.single("image"), 
          [
            check("packageCategory").not().isEmpty(),
            check("blogType").not().isEmpty(),
            check("packageDescription").not().isEmpty(),
            check("testsIncluded").not().isEmpty(),
            check("discountedPrice").not().isEmpty(),
            check("idealFor").not().isEmpty(),
            check("preRequisites").not().isEmpty(),
            check("isSpecial").isBoolean()
          ],
          async (req, res) => {
  try {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
      console.log(errors);
      return res.status(400).json({code: 400, message: errors});
    }
    // console.log(req);
    const check = await client.query(
      `SELECT * FROM "aptpackages" WHERE "packageID" = $1`, [req.body.packageID]
    );
    // console.log(check);

    let storeImage = "", result;
    // console.log(req.file);
    const uploadResult = await uploadFile(req.file);
    storeImage = uploadResult.Location;

    if (check.rows.length < 1) {
      result = await client.query(
        `INSERT INTO "aptpackages" ("type", "packageName", "description", "packageAmount", "discountedAmount",
        "testsIncluded", "preRequisites", "idealFor", "packageID", "isSpecial", "image", 
        "packageCategory", "packageCode") 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          req.body.blogType,
          req.body.packageName,
          req.body.packageDescription,
          req.body.packageAmount,
          req.body.discountedPrice,
          JSON.parse(req.body.testsIncluded),
          JSON.parse(req.body.preRequisites),
          JSON.parse(req.body.idealFor),
          req.body.packageID,
          req.body.isSpecial,
          storeImage,
          req.body.packageCategory,
          req.body.packageCode
        ]
      );
    } 
    else {
      result = await client.query(
        `UPDATE "aptpackages" SET "type" = $1, "packageName" = $2, "description" = $3, 
        "packageAmount" = $4, "testsIncluded" = $5, "preRequisites" = $6, "idealFor" = $7, 
        "isSpecial" = $8, "image"= $9, "packageCategory" = $10, "packageCode" = $11, "discountedAmount" = $12 
        WHERE "packageID" = $13`,
        [
          req.body.blogType,
          req.body.packageName,
          req.body.packageDescription,
          req.body.packageAmount,
          JSON.parse(req.body.testsIncluded),
          JSON.parse(req.body.preRequisites),
          JSON.parse(req.body.idealFor),
          req.body.isSpecial,
          storeImage,
          req.body.packageCategory,
          req.body.packageCode,
          req.body.discountedPrice,
          req.body.packageID,
        ]
      );
    }
    // console.log(result.data);
    res.status(200).json({data: result.data});
  } catch (err) {
    console.log(err);
    res.status(500).json({code: 500, message: err});
  }
});

// tests

app.get("/admin/getAllTests", async (req, res) => {
  try {
    const result = await client.query(
      `SELECT * FROM "apttests"  ORDER BY "testID"`
    );

    res.json(result.rows);
  } catch (e) {
    res.send("Internal Server Error").status(500);
  }
});

app.get("/admin/checkAndGetTestById", async (req, res) => {
  try {
    const result = await client.query(
      `SELECT * FROM "apttests" WHERE "testID" = $1`,
      [req.query.Id]
    );
    if (result.rows.length === 0) {
      const testList = await axios.get(
        `https://staging.livehealth.solutions/getAllTestsAndProfiles/?token=${process.env.LIVE_HEALTH_TOKEN}`
      );
      const tempDict = await testList.data.testList.filter(
        (item) => item.testID == req.query.Id
      );
      if (tempDict.length === 0) {
        res.json({ status: 400, body: [] });
      } else {
        let finalDict = {
          type: tempDict[0].integrationCode,
          testName: tempDict[0].testName,
          description: "",
          testAmount: tempDict[0].testAmount,
          details: "",
          testID: tempDict[0].testID,
          isSpecial: false,
          imageLink: "",
          sampleReportImage: "",
        };
        res.json({ status: 200, body: finalDict });
      }
    } else {
      res.json({ status: 200, body: result.rows[0] });
    }
  } catch (e) {
    console.log(e);
    res.json({ status: 500 });
  }
});

app.get("/admin/getTests", async (req, res) => {
  try {
    const response = await client.query("SELECT * FROM apttests");

    res.send("worked").status(200);
  } catch (err) {
    console.log(err);
    res.send("failed").status(500);
  }
});

app.post("/admin/uploadTest", async (req, res) => {
  try {
    const response = await client.query(
      `INSERT INTO "apttests" VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.body["testID"],
        req.body["testName"],
        req.body["description"],
        req.body["details"],
        req.body["imageLink"],
        req.body["sampleReportImage"],
        req.body["testAmount"],
        req.body["faq"],
      ]
    );
    res.send("worked").status(200);
  } catch (err) {
    console.log(err);
    res.send("failed").status(500);
  }
});

app.post("/admin/postTest", 
          upload.single("testImage"), [
            check("testCategory").not().isEmpty(),
            check("blogType").not().isEmpty(),
            check("details").not().isEmpty(),
            check("discountedAmount").not().isEmpty(),
            check("relatedOrgan").not().isEmpty(),
            check("isSpecial").isBoolean()
          ], 
          async (req, res) => {
  try {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
      console.log(errors);
      return res.status(400).json({code: 400, message: errors});
    }

    const check = await client.query(
        `SELECT * FROM "apttests" WHERE "testID" = $1`, [req.body.testID]
    );

    let testImage = "", result, testReport = "";
    
    const uploadResult = await uploadFile(req.file);
    testImage = uploadResult.Location;
    
    if (check.rows.length < 1) {
      result = await client.query(
        `INSERT INTO "apttests" ("testID", "testName", "description", "details", "imageLink", "sampleReportImage", 
          "testAmount", "isSpecial", "type", "testCode", "testCategory", "organRelated", "discountedAmount") VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          req.body.testID,
          req.body.testName,
          req.body.description,
          req.body.details,
          testImage,
          testReport,
          req.body.testAmount,
          req.body.isSpecial,
          req.body.blogType,
          req.body.testCode,
          req.body.testCategory,
          req.body.relatedOrgan,
          req.body.discountedAmount
        ]
      );
    } 
    else {
      result = await client.query(
        `UPDATE "apttests" SET "organRelated" = $1, "testName" = $2, "description" = $3, "details" = $4, "imageLink" = $5, 
        "sampleReportImage" = $6, "testAmount" = $7, "isSpecial" = $8, "type" = $9, "testCode" = $10, "testCategory" = $11,
         "discountedAmount" = $12 WHERE "testID" = $13`,
        [
          req.body.relatedOrgan,
          req.body.testName,
          req.body.description,
          req.body.details,
          testImage,
          testReport,
          req.body.testAmount,
          req.body.isSpecial,
          req.body.blogType,
          req.body.testCode,
          req.body.testCategory,
          req.body.discountedAmount,
          req.body.testID
        ]
      );
    }
    res.status(200).json({data: result.data});
  } catch (err) {
    console.log(err);
    res.status(500).json({code: 500, message: err});
  }
});

// blogs

app.get("/admin/getAllBlogs", async (req, res) => {
    try{
      const result = await client.query(`SELECT * FROM "aptblogs"  ORDER BY "blogId"`);
      res.json(result.rows).status(200);    
    }
    catch(e){
      console.log(e);
      res.send("Internal Server Error").status(500);
    }
});

app.get("/admin/checkAndGetBlogById", async (req, res) => {
    try{
        const result = await client.query(`SELECT * FROM "aptblogs" WHERE "blogId" = $1`, [req.query.Id]);
        if(result.rows.length == 1){
            console.log(result.rows[0]);
            res.send(result.rows).status(200);
        }
        else{
            res.send("Invalid Id").status(400);
        }
    }
    catch(err){
        console.log(err)
        res.send("Internal Server Error").status(500);
    }

});

//Admin - Update Blog
// const blogUpload = upload.fields([{testName:"videoFile" , maxCount:1}, {testName:"images", maxCount:4}]);
const blogUpload = upload.fields([
  {name :"videoFile", maxCount:1}, 
  {name :"authorImage", maxCount:1},
  {name: "blogImage", maxCount: 1}
]);

app.post("/admin/postBlog", blogUpload, [
            check("author").not().isEmpty(),
            check("blogHeading").not().isEmpty(),
            check("blogSubHeading").not().isEmpty(),
            check("blogType").not().isEmpty(),
            check("blogId").not().isEmpty()
          ],
           async (req,res) => {
    try{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
          return res.status(400).json({code: 400, message: errors});
        }
        let authorImage = "";
        let blogImage = "";
        let videoFile = "";
        let content = req.body.content;

        if(req.body.isVideoBlog === 'true' && req.files.videoFile === undefined){
          return res.status(404).json({code: 404, message: "Media Files Missing"});
        }

        const checkExist = await client.query(`SELECT * FROM "aptblogs" WHERE "blogId" = $1`, [req.body.blogId])
        console.log(checkExist.rows)
        if(checkExist.rows.length === 0){
          return res.status(404).json({code: 404, message: "No Entry Found with this Blog ID"});
        }

        let result;

        if(req.files.authorImage !== undefined){
          result = await uploadFile(req.files.authorImage[0]);
          authorImage = result.Location;
        }
        else{
          authorImage = checkExist.rows[0].authorThumbnail;
        }

        // -------------------------------------

        if(req.files.blogImage !== undefined){
          result = await uploadFile(req.files.blogImage[0]);
          blogImage = result.Location;
        }
        else{
          blogImage = checkExist.rows[0].imageLinks;
        }

        // -------------------------------------

        if(req.body.isVideoBlog === 'true'){
          result = await uploadFile(req.files.videoFile[0]);
          videoFile = result.Location;
        }
        else{
          videoFile = checkExist.rows[0].videoLink;
        }

        // -------------------------------------

        if(content.length === 0){
          content = checkExist.rows[0].content;
        }

        const uploadResult = await client.query(
          `UPDATE "aptblogs" SET "author" = $1, "content" = $2, "heading" = $3, 
          "subHeading" = $4, "authorThumbnail" = $5, "isVideoBlog" = $6, 
          "videoLink" = $7, "imageLinks" = $8, "category" = $9, "isFeatured" = $10,
          "updateTime" = $11 where "blogId" = $12 returning *`,[
            req.body.author,
            content,
            req.body.blogHeading,
            req.body.blogSubHeading,
            authorImage,
            req.body.isVideoBlog,
            videoFile,
            blogImage,
            req.body.blogType,
            req.body.blogFeatured,
            new Date(),
            req.body.blogId
        ])

        // console.log(uploadResult.rows[0]);
        res.send(uploadResult.rows[0]).status(200);
    }
    catch(err){
        console.log(err)
        res.status(500).json({code: 500, message: "Internal Server Issue"});
    }
});

app.post("quickLogin",async(req,res)=>{
  try{
    const result = await client.query(`SELECT * FROM "apttestuser" WHERE "contact" = $1`,[req.body.contact])
    res.json({code:200,data:result.rows[0]})
  }catch(err){console.log(err)
  res.json({code:500,data:err})}
})

//Admin- Add blog
const insertBlogUpload = upload.fields([
    {name :"videoFile", maxCount:1}, 
    {name :"authorImage", maxCount:1},
    {name: "blogImage", maxCount: 1}
]);

app.post("/admin/insertBlog", 
        insertBlogUpload, [
          check("author").not().isEmpty(),
          check("blogHeading").not().isEmpty(),
          check("blogSubHeading").not().isEmpty(),
          check("content").not().isEmpty(),
          check("blogType").not().isEmpty()
        ], async (req, res) => {
    
    try{
        const errors = validationResult(req);
        if(!errors.isEmpty()){
          return res.status(400).json({code: 400, message: errors});
        }

        let authorImage = "";
        let blogImage = "";
        let videoFile = "";

        // console.log(req.body);
        // console.log(req.files);

        if(req.files.authorImage === undefined || req.files.blogImage === undefined || (req.body.isVideoBlog === 'true' && req.files.videoFile === undefined)){
          return res.status(404).json({code: 404, message: "Media Files Missing"});
        }
        
        let result = await uploadFile(req.files.authorImage[0]);
        authorImage = result.Location;

        // console.log("AuthorImage - ", authorImage);

        result = await uploadFile(req.files.blogImage[0]);
        blogImage = result.Location;

        // console.log("Blog Image - ", blogImage);

        if(req.body.isVideoBlog === 'true'){
          result = await uploadFile(req.files.videoFile[0]);
          videoFile = result.Location;
        }

        // console.log("Video Link - ", videoFile);

        const insertResult = await client.query(`INSERT INTO "aptblogs" 
          ("author", "content", "heading", "subHeading", "authorThumbnail", "isVideoBlog", "videoLink", 
          "imageLinks", "category", "isFeatured", "updateTime") 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`, [
            req.body.author,
            req.body.content,
            req.body.blogHeading,
            req.body.blogSubHeading,
            authorImage,
            req.body.isVideoBlog,
            videoFile,
            blogImage,
            req.body.blogType,
            req.body.blogFeatured,
            new Date()
        ]);

        res.send(insertResult.rows[0]).status(200)
    }
    catch(err){
        console.log(err)
        res.send("Internal Server Error").status(500)
    }
})


app.post("/admin/uploadTest",async (req,res)=>{
    try{
    const response = await client.query(`INSERT INTO "apttests" VALUES ($1,$2,$3,$4,$5,$6)`,[
        req.body["testID"],
        req.body["testName"],
        req.body["description"],
        req.body["details"],
        req.body["imageLink"],
        req.body["sampleReportImage"],
        req.body["testAmount"],
        req.body["faq"],
        
    ])
    res.send("worked").status(200)
    }
    catch (err){
        console.log(err)
        res.send("failed").status(500)
    }
})
//Admin - insertBlogContent
app.post("/admin/insertBlogContent", async (req,res) => {
    console.log("done")
    try {
        console.log(req.body)
        const uploadResult = await client.query(`UPDATE "aptblogs" SET "content" = $1 where "blogId" = $2 returning *`,[
            req.body.insertContentData,
            req.body.blogId
        ])
        
        res.status(200).json({status : "success"})
    }
    catch(err) {
        console.log(err)
        res.send("Internal Server Error").status(500)
    }
})

//getAllBlogs
app.get("/allblogs", async(req, res) => {
    try{
        const result = await client.query(`SELECT * FROM "aptblogs"  ORDER BY "blogId"`)
        // console.log(result.rows)
        if(result.rows.length > 0) {
            res.status(200).json({
                status : "Success",
                data : result.rows
            })
        }
        else {
            res.status(500).json({
                status : "fail",
                message : "Data not found"
            })
        }
      }
    catch(e){
        console.log(e)
        res.send("Internal Server Error").status(500)
    }
})

app.delete("/admin/deletePackage", [
          check("packageID")
        ], async (req, res) => {
        try{
          const errors = validationResult(req);
          if(!errors.isEmpty()){
            return res.status(404).json({code: 404, message: "packageID not found"});
          }
  
          const checkExist = await client.query(`SELECT * FROM "aptpackages" WHERE 
            "packageID" = $1`, [req.query.packageID]);
          
          // console.log(checkExist.rows[0].image);

          if(checkExist.rows.length === 0){
            return res.status(400).json({code: 400, message: "Couldn't find a package for respective packageID"});
          }
          
          const result = await deleteFile(checkExist.rows[0].image);
          // console.log("Delete Result" - result);

          const uploadResult = await client.query(`DELETE FROM "aptpackages" WHERE "packageID" = $1 RETURNING *`, 
            [req.query.packageID]
          );
          if(uploadResult.rows.length > 0){
            res.status(200).json({code: 200, message: "Successfully Deleted"});
          }
          else{
            res.status(500).json({code: 500, message: "Couldn't Delete package"});
          }
          // console.log(uploadResult.rows);
        }
        catch(err){
          console.log(err);
          res.status(500).json({code: 500, message: err});
        }
});

app.delete("/admin/deleteTest", [
          check("testID")
        ], async (req, res) => {
        try{
          const errors = validationResult(req);
          if(!errors.isEmpty()){
            return res.status(404).json({code: 404, message: "testID not found"});
          }
  
          const checkExist = await client.query(`SELECT * FROM "apttests" WHERE 
            "testID" = $1`, [req.query.testID]);
  
          if(checkExist.rows.length === 0){
            return res.status(400).json({code: 400, message: "Couldn't find a test for respective testID"});
          }
  
          const uploadResult = await client.query(`DELETE FROM "apttests" WHERE "testID" = $1 RETURNING *`, 
            [req.query.testID]
          );
          // console.log(uploadResult.rows);
          if(uploadResult.rows.length > 0){
            res.status(200).json({code: 200, message: "Successfully Deleted"});
          }
          else{
            res.status(500).json({code: 500, message: "Couldn't Delete test"});
          }
        }
        catch(err){
          console.log(err);
          res.status(500).json({code: 500, message: err});
        }
});

app.delete("/admin/deleteBlog", [
          check("blogID")
        ], async (req, res) => {
        try{
          const errors = validationResult(req);
          if(!errors.isEmpty()){
            return res.status(404).json({code: 404, message: "blogID not found"});
          }
  
          const checkExist = await client.query(`SELECT * FROM "aptblogs" WHERE 
            "blogId" = $1`, [req.query.blogID]);
  
          if(checkExist.rows.length === 0){
            return res.status(400).json({code: 400, message: "Couldn't find a blog for respective blogId"});
          }
  
          const uploadResult = await client.query(`DELETE FROM "aptblogs" WHERE "blogId" = $1 RETURNING *`, 
            [req.query.blogID]
          );
          console.log(uploadResult.rows);
          if(uploadResult.rows.length > 0){
            res.status(200).json({code: 200, message: "Successfully Deleted"});
          }
          else{
            res.status(500).json({code: 500, message: "Couldn't Delete blog"});
          }
        }
        catch(err){
          console.log(err);
          res.status(500).json({code: 500, message: err});
        }
});

//For Coupons
// modification required
app.post("/giftCoupon", async (req,res)=>{
    try{
        const verifyCoupon =  await client.query(`SELECT "giftedTestList" ,"couponAmount" , "couponCode" FROM "aptgifts" WHERE "couponCode" = $1 AND "isValid" = 'true' `,[req.body.coupon])
        console.log(verifyCoupon)
        if(verifyCoupon.rows.length > 0) {
            res.json({
                code:200,
                data : verifyCoupon.rows[0]
            })
        }
        else if(verifyCoupon.rows.length === 0){
            res.status(400).json({
                code:400,
                message:"Invalid Coupon Code",
                data : null
            })
        }
        }
    catch(err) {
        console.log(err)
        res.status(500).json({
            message : "Internal Error || Server issue",
            data:0
        })
    }
}
)


// apply coupon
app.get("/applyCoupon", async (req, res) => {
    try{

      // console.log(req.body);
      // console.log(req.query);
      const verifyCoupon =  await client.query(`SELECT * FROM "aptcoupons" WHERE "couponCode" = $1`, 
        [req.query.coupon]);

      if(verifyCoupon.rows.length > 0) {
        const userCheck = await client.query(`SELECT "couponsUsed" FROM "apttestuser" 
          WHERE "contact" = $1`, [req.query.contact]);
        if(userCheck.rows.length > 0){
          // console.log(userCheck.rows[0]);
          const coupons = userCheck.rows[0].couponsUsed;
          // console.log(coupons);
          if(coupons === null || coupons.length === 0){
            res.json({
              coupon: req.query.coupon,
              discount: parseInt(verifyCoupon.rows[0].couponPercent),
              message: `Yay, you got ${parseInt(verifyCoupon.rows[0].couponPercent)}% off !!`,
              code: 200
            });
          }
          else{
            const applied =  [...coupons].filter(code => code === req.query.coupon);
            if(applied.length !== 0){
              res.json({
                coupon: req.query.coupon,
                discount: 0,
                message: "Coupon already used!",
                code: 400
              });
            }
            else{
              res.json({
                coupon: req.query.coupon,
                discount: parseInt(verifyCoupon.rows[0].couponPercent),
                message: `Yay, you got ${parseInt(verifyCoupon.rows[0].couponPercent)}% off !!`,
                code: 200
              });
            }
          }
        }
        else{
          res.json({
            coupon: req.query.coupon,
            discount: parseInt(verifyCoupon.rows[0].couponPercent),
            message: `Yay, you got ${parseInt(verifyCoupon.rows[0].couponPercent)}% off !!`,
            code: 200
          });
        }

      }
      else{
        res.json({
          coupon: req.query.coupon,
          discount: 0,
          message: `Couldn't find coupon for ${req.query.coupon}`,
          code: 400
        });
      }
    }
    catch(err){
      console.log(err);
      res.json({
        code: 500,
        message: "Something went wrong, Internal Error"
      });
    }
});

// getAllCoupons
app.get("/getAllCoupons", async (req, res) => {
  try{
    const response = await client.query(`SELECT * FROM "aptcoupons"`);
    res.json(response.rows).status(200);
  }catch(err){
    console.log(err);
    res.status(500).json([]);
  }
})

// addCoupons
app.post("/uploadCoupon", [
    check("couponCode").not().isEmpty(),
    check("couponPrice").not().isEmpty()
  ],
  async (req, res) => {
  try{
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.json(errors).status(400);
    }
    const result = await client.query(`INSERT INTO "aptcoupons" VALUES ($1, $2)`, [req.body.couponCode, req.body.couponPrice]);
    if(result.rowCountra > 0){
      res.json({code: 200, message: "Coupon Added Successfully"}).status(200);
    }
    else{
      res.json({code: 500, message: "Couldn't add coupon"}).status(500);
    }
  }
  catch(err){
    console.log(err);
    res.json({code: 500, message: "Server Issue, try again!"}).status(500);
  }
});

// index Page

app.get("/getCovidTests", async(req,res)=>{
  try{
    const response = await client.query(`SELECT * FROM "apttests"  WHERE "isSpecial" = TRUE AND TYPE='covid'`);
    const data = response.rows;
    res.send({code:200,data}).status(200);
  }
  catch(e){
    console.log(e)
    res.status(500).send()
  }
})

app.get("/getPackages", async(req, res) => {
  try{
    const response = await client.query(`SELECT * FROM "aptpackages"  WHERE "isSpecial" = 'true' `);
    const data = response.rows;
    res.send({code:200,data}).status(200);
  }
  catch(e){
    console.log(e);
    res.status(500).send();
  }
})

app.get("/getAllFeaturedTests",async(req,res)=>{
  try{
    const response = await client.query(`SELECT * FROM "apttests"  WHERE "isSpecial" = 'true'`)
    const data = response.rows
    res.send({code:200,data}).status(200)
  }
  catch(e){
    console.log(e)
    res.send().status(500)
  }
})




app.post("/testAPI",async(req,res)=>{
  await setSlot(req.body)
  res.send("ok")
})

//Slot Booking --- Section
// input format yyyy-mm-dd

app.get("/slotBooking", async(req, res) => {
  try{
    const result = await client.query(`SELECT * FROM "aptbookings" WHERE "slot" = $1`, [req.query.slot]);

    const decryptSlot = { 7:"slot1", 8:"slot2", 9:"slot3", 10:"slot4", 11:"slot5", 12:"slot6",
                          13:"slot7", 14:"slot8", 15:"slot9", 16:"slot10", 17:"slot11", 
                          18:"slot12", 19:"slot13", 20:"slot14", 21:"slot15"};

    const slots = { slot1:0, slot2:0, slot3:0, slot4:0, slot5:0, slot6:0, slot7:0, slot8:0, 
                    slot9:0, slot10:0, slot11:0, slot12:0, slot13:0, slot14:0, slot15:0};

    for (let a of result.rows){
      let date = new Date(a.slot).getUTCHours();
      // console.log(date);
      if(date < 7 && date > 21){}
      else{
        slots[decryptSlot[date]]++
      }
    }
    // console.log(slots);
    res.json(slots);
  }
  catch(err){
    console.log(err);
    res.sendStatus(500);
  }
})

app.post("/slotBooking",async(req,res) => {
  try{
    const result = await client.query(`SELECT * FROM "aptbookings" WHERE "slot"::DATE = $1`, [req.body.slot]);
    let decryptSlot = {7: "slot1", 8: "slot2", 9: "slot3", 10: "slot4", 11: "slot5", 12: "slot6", 13: "slot7",
                      14: "slot8", 15: "slot9", 16: "slot10", 17: "slot11", 18: "slot12", 19: "slot13",
                      20: "slot14", 21: "slot15"};
    let slots = { slot1:0, slot2:0, slot3:0, slot4:0, slot5:0, slot6:0, slot7:0, slot8:0, slot9:0, 
                  slot10:0, slot11:0, slot12:0, slot13:0, slot14:0, slot15:0};
    for (var a of result.rows){
      slots[decryptSlot[new Date(a.slot).getUTCHours()]]++
    }
    res.json(slots).status(200);
  }catch(err){
    console.log(err);
    res.status(500).send(err);
  }
})

// set slot

const setSlot = async (data) => {
  // console.log(data);
  try{
    await client.query(`INSERT INTO "aptbookings" VALUES ($1, $2)`,[data.mobile, data.slotTime]);
    // console.log(result);
    return true;

  }catch(err){
    console.log(err);
    return false;
  }
}

// manage flebo

app.get("/getFlebo",async (req,res)=>{
  try{
    // sendMail()
    const result = await client.query(`SELECT * FROM "aptutils"`);
    // console.log(result.rows[0]);
    res.status(200).json(result.rows[0]);
  }
  catch(err){
    console.log(err);
    res.status(500);
  }
});


app.post("/setFlebo", [
      check("newFlebo").isNumeric(),
      check("currFlebo").isNumeric()
    ], async (req,res) => {
  try{
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.status(400).json({code: 400, message: errors});
    }
    const result = await client.query(`UPDATE "aptutils" SET "flebo" = $1 WHERE "flebo" = $2 `,
                        [req.body.newFlebo, req.body.currFlebo]);
    console.log(result);
    if(result.rowCount > 0){
      res.status(200).json({code: 200, message: "Successfully Updated"});
    }
    else{
      res.status(500).json({code: 500, message: "Server Issue, try again later!"});
    }
  }
  catch(err){
    console.log(err);
    res.status(500).json({code: 500, message: "Server Issue, try again later!"});
  }
});

// admin - fetch subscribers email
app.get("/admin/getSubscribers", async(req, res) => {
  try{
    const result = await client.query(`SELECT * FROM "aptsubscribers"`);
    // console.log(result.rows.length);
    if(result.rows.length > 0 ){
      res.json(result.rows).status(200);
    }
    else{
      res.json([]).status(400);
    }
  }
  catch(err){
    console.log(err);
    res.status(500).json([]);
  }
});

// admin - fetch users email
app.get("/admin/fetchUserList", async(req, res) => {
  try{
    const result = await client.query(`SELECT "userName", "email" FROM "apttestuser"`)
    if(result.rows.length > 0){
      res.json(result.rows).status(200);
    }else{
      res.json([]).status(400);
    }
  }
  catch(err){
    console.log(err);
    res.status(500).json([]);
  }
});

// fetch Contactus
app.get("/admin/fetchContactus", async(req, res) => {
  try{
    const result = await client.query(`SELECT * FROM "aptcontactus"`);
    if(result.rows.length > 0){
      res.json(result.rows).status(200);
    }
    else{
      res.json([]).status(400);
    }
  }
  catch(err){
    console.log(err);
    res.json([]).status(500);
  }
});

// fetchFeedbacks
app.get("/admin/fetchFeedbacks", async (req, res) => {
  try{
    const result = await client.query(`SELECT * FROM "aptquery"`);
    if(result.rows.length > 0){
      res.json(result.rows).status(200);
    }
    else{
      res.json([]).status(400);
    }
  }
  catch(err){
    console.log(err);
    res.json([]).status(500);
  }
});

// post prescriptions

app.post("/postPrescription",
          prescriptionUpload.single("file"), [
            check("name").not().isEmpty(),
            check("mobile").isLength({min: 10}).isNumeric()
          ],
          async(req, res) => {
            try{
              const errors = validationResult(req);
              if(!errors.isEmpty()){
                return res.status(400).json({errors});
              }
              const data = req.body;
              const uploadResult = await uploadFile(req.file);
              const attachment = uploadResult.Location;
              const result = await client.query(`INSERT INTO "aptprescription" VALUES ($1, $2, $3)`, [
                data.name, data.mobile, attachment
              ]);
              return res.send(result.data).status(200);
            }
            catch(err){
              console.log(err);
              res.send(err).status(500);
            }
          }
);

// post feedback/complaint

app.post("/postFeedback", 

          upload.single("attachment"), [
          check('name').not().isEmpty(),  // validations
          check('type').not().isEmpty(),
          check('contact').isNumeric().isLength({min: 10}),
          check('query').not().isEmpty() ],

          async(req, res)=>{
            try{
              // console.log(req.body);

              const errors = validationResult(req);
              if(!errors.isEmpty()){
                // console.log(errors);
                return res.status(400).json({'errors': errors});
              }
              const data = req.body;
              let attachment = "";
              if (req.file === undefined || req.file === null) {
                attachment = "";
              } else {
                const uploadResult = await uploadFile(req.file);
                attachment = uploadResult.Location;
              }
              const result = await client.query(`INSERT INTO "aptquery" VALUES ($1, $2, $3, $4, $5, $6)`,
                    [data.name, data.email, data.type, data.contact, data.query, attachment]);
              res.send(result.data).status(200);
            }
            catch(err){
              console.log(err);
              res.status(500);
            }
          }
);

// post contactus

app.post("/postContactus",
          
          check('name').not().isEmpty(),
          check('contact').isNumeric().isLength({min: 10}),
          check('queryType').not().isEmpty(),
          check('queryDescription').not().isEmpty(),

          async(req, res) => {
            try{  

              // console.log(req.body);
              const errors = validationResult(req);
              if(!errors.isEmpty()){
                return res.status(400).json({'errors': errors});
              }

              const data = req.body;
              const result = await client.query(`INSERT INTO "aptcontactus" VALUES ($1, $2, $3, $4, $5)`,
                      [data.name, data.email, data.contact, data.queryType, data.queryDescription]);
              res.send(result.data).status(200);
            }
            catch(err){
              console.log(err);
              res.status(500);
            }
          }
); 

app.post("/requestCallback", async (req,res)=>{
  try{
    console.log(req.body)
    const response = await client.query(`INSERT INTO "callbackrequests" VALUES ($1 , $2)`,[req.body.name, req.body.number])
    res.json({code:200})
  }catch(err){
    console.log(err)
    res.json({code:500})
  }
})


app.listen(process.env.PORT || 5000,()=>{
    console.log(process.env.PORT || 5000);
});



