/******************************************************************************
  zwallet.js - UMCG ZorgWallet

    Server side application for submitting transactions from client
    Developed for the blockchain PoC for UMCG, Groningen, The Netherlands
    For this initial demo only 2 actors have been modeled:
      1. klant: customer / client
      2. zorgaanbieder: service provider

    Valid transactions for client:
      - aftekenen: sign off on a delivered service ('zorg')
      - betalen: pay the monthly contribution ('eigen bijdrage')
      - overzicht: get overview of all delivered 'zorg' and contribution due
      - NOTE: more - tbd

    Copyright Trusting Edge Technologies 2017 - All Rights Reserved

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

******************************************************************************/
// 'use strict';

process.env.GOPATH = __dirname;

var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');

var Fabric_Client = require('fabric-client');
var path = require('path');
var util = require('util');
var os = require('os');

var fs = require('fs');

// var http = require('http');
// var https = require('https');
const https = require('https');

var tdb = require('./tesdb');

var configData;     // Configuration and fixed data read from JSON file
var listenPort = 8081;
var appRoot;
var enrollId;
var channelId;
var dbName;

// Menu function options - context specific
var funcArray = [ {name:'getzorgwallet', label:'Inzien ZorgWallet'},
                  {name:'getcontract', label:'Inzien zorgcontract'},
                  {name:'zvform', label:'Toevoegen zorgvoorziening aan contract'},
                  // {name:'deletezorgvoorziening', label:'Verwijderen zorgvoorziening'},
                  {name:'zorgform', label:'Leveren zorg'},
                  // {name:'payeigenbijdrage', label:'Betalen eigen bijdrage'},
                  {name:'getevents', label:'Overzicht events & alarmen'},
                  {name:'getnotes', label:'Inzien berichten in logboek'},
                  {name:'noteform', label:'Aanmaken bericht in logboek'},
                  {name:'userselectform', label:'Selecteren client'},
                  // {name:'setperiod', label:'Zet datum naar volgende maand'},
                  {name:'logout', label:'Uitloggen'}
                ];

var funcArrayEv = [ {name:'getevents', label:'Overzicht events & alarmen'},
                    {name:'logout', label:'Uitloggen'}
                ];

var funcArrayNote = [ {name:'getnotes', label:'Inzien berichten in logboek'},
                    {name:'logout', label:'Uitloggen'}
                ];

var funcArrayZV = [ {name:'getzorgwallet', label:'Inzien ZorgWallet'},
                    {name:'getcontract', label:'Inzien zorgcontract'},
                    {name:'signoffzorg', label:'Aftekenen ontvangen zorg'},
                    {name:'logout', label:'Uitloggen'}
                ];

var store_path;
var fabric_client;
var channel;
var peer;
var order;
var tx_id;

var chain;
var network;
var peers;
var users;
var userObj;
var chaincodeID;

var db;

//
// Express setup
//
var app = express();
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Pass the name of the directory for keeping static assets (images, etc.)
// Browser starts at this 'root' looking for images, etc.
app.use(express.static(path.join(__dirname, 'public')));

// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser());

// Use sessions
app.use(session({secret: 'Wmo-on-the-Blockchain1234!', resave: true, saveUninitialized: true}));

// Create application/x-www-form-urlencoded parser
var urlencodedParser = bodyParser.urlencoded({ extended: false })

// Get request either from home page or index.html
app.get('/', function (req, res) {
   console.log("\nGET request for home page - __dirname: " + __dirname);

   req.session.imglogo = "logo.png";

   res.render('login', {
     formaction: req.session.formaction,
     funcoptions: req.session.funcoptions,
     imglogo: req.session.imglogo,
     date: req.session.date
   });
})

app.post('/login', urlencodedParser, function (req, res) {
   console.log("\nPOST request for /login - login by User ID: " + req.body.loginid);

   login(req, res);

   res.redirect(appRoot + '/main'); // Redirect to /main, i.e. the app.get below
})

app.get('/main', function (req, res) {
   console.log("\nGET request for /main - __dirname: " + __dirname);

   // req.session.formaction = "http://" + req.headers.host + appRoot + "/process_post";
   req.session.formaction = appRoot + "/process_post";
   req.session.imglogo = "logo.png";
   req.session.message = null;
   req.session.errmessage = null;

   res.render('index', {
     formaction: req.session.formaction,
     funcoptions: req.session.funcoptions,
     imglogo: req.session.imglogo,
     loginname: req.session.loginname,
     username: req.session.username,
     userid: req.session.userid,
     birthdate: req.session.birthdate,
     gemeente: req.session.gemeente,
     orgname: req.session.orgname,
     date: req.session.date,
     message: req.session.message,
     errmessage: req.session.errmessage
   });
})

app.post('/process_post', urlencodedParser, function (req, res) {

  console.log("POST request for /process_post - associated user: %s - selected function: %s",
                    req.session.userid, req.body.function);

  req.session.formaction = appRoot + "/process_post";
  req.session.message = null;
  req.session.errmessage = null;

  if (!req.session.userid || req.session.userid == '') {
    console.log("No user logged in");
    req.session.errmessage = 'No user logged in';
    return res.redirect(appRoot);      // Force back to home / login page
  }

  // Get organisation data record + current period (= the virtual date)
  var args = [];
  args.push(req.session.orgid);
  query(enrollId, req.session.loginid, "getorgdata", args, function(err, data) {
    if (err) {
      req.session.errmessage = err;
      console.log("app.post getorgdata - failed to get query data: ", err);
    } else {
      console.log("app.post getorgdata - query result: ", data);
      orgdata = JSON.parse(data);
      req.session.period = orgdata.period;
      var now = new Date();
      now.setMonth(now.getMonth() + orgdata.period - 1); // Add 'period' months
      req.session.date = now.toLocaleDateString();
    }

    args = [];

    // Retrieve the 'Zorgcontract' between Client (User) and Gemeente
    if (req.body.function == "getcontract") {
      getContract(req, res);

    // Retrieve the 'ZorgWallet' for Client (User)
    } else if (req.body.function == "getzorgwallet") {
      getZorgwallet(req, res);

    // Add a 'Zorgvoorziening' to the 'Zorgcontract'
    } else if (req.body.function == "addzorgvoorziening") {
      addZorgvoorziening(req, res);

    // Deliver 'Zorg' to Client (User)
    } else if (req.body.function == "deliverzorg") {
      deliverZorg(req, res);

    // Sign-off (confirm & commit by Client / User) the delivered 'Zorg'
    } else if (req.body.function == "signoffzorg") {
      signoffZorg(req, res);

    // Retrieve events for current user
    } else if (req.body.function == "getevents") {
      getEvents(req, res);

    // Retrieve notes for current user
    } else if (req.body.function == "getnotes") {
      getNotes(req, res);

    // Select user (client / patient)
    } else if (req.body.function == "selectuser") {
      selectUser(req, res);

    // Create a new note and add it to the owner's note queue
    } else if (req.body.function == "addnote") {
      addNote(req, res);

    // Set up a 'zorgvoorziening' form
    } else if (req.body.function == "zvform") {
      res.render('zvform', {
          title: "Zorgvoorzieningformulier",
          formaction: req.session.formaction,
          funcoptions: funcArrayZV,
          imglogo: req.session.imglogo,
          loginname: req.session.loginname,
          username: req.session.username,
          userid: req.session.userid,
          birthdate: req.session.birthdate,
          gemeente: req.session.gemeente,
          orgname: req.session.orgname,
          date: req.session.date
      });

    // Set up a 'zorg' form for delivery of 'zorg' (care)
    } else if (req.body.function == "zorgform") {
      res.render('zorgform', {
          title: "Zorgformulier",
          formaction: req.session.formaction,
          funcoptions: funcArrayZV,
          imglogo: req.session.imglogo,
          loginname: req.session.loginname,
          username: req.session.username,
          userid: req.session.userid,
          birthdate: req.session.birthdate,
          gemeente: req.session.gemeente,
          orgname: req.session.orgname,
          date: req.session.date
      });

    // Set up a note form
    } else if (req.body.function == "noteform") {
      res.render('noteform', {
          title: "Berichtenformulier",
          formaction: req.session.formaction,
          funcoptions: funcArrayNote,
          imglogo: req.session.imglogo,
          loginname: req.session.loginname,
          username: req.session.username,
          userid: req.session.userid,
          birthdate: req.session.birthdate,
          gemeente: req.session.gemeente,
          orgname: req.session.orgname,
          date: req.session.date
      });

    // Set up a user select form
    } else if (req.body.function == "userselectform") {

      res.render('userselectform', {
          title: "Selecteren client",
          formaction: req.session.formaction,
          funcoptions: funcArrayNote,
          imglogo: req.session.imglogo,
          loginname: req.session.loginname,
          username: req.session.username,
          userid: req.session.userid,
          birthdate: req.session.birthdate,
          gemeente: req.session.gemeente,
          orgname: req.session.orgname,
          date: req.session.date
      });

   // Delete a 'Zorgvoorziening' from the 'Zorgcontract'
   } else if (req.body.function == "delzorgvoorziening") {
     args.push(req.session.userid);
     invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
       if (err) {
         req.session.errmessage = err;
         console.log("app.post delzorgvoorziening - invoke failed with error: ", err);
       } else {
         req.session.message = "Verwijderen zorgvoorziening succesvol uitgevoerd";
         console.log("app.post delzorgvoorziening - invoke finished successfully, result: %s", data);
       }

       res.render('index', {
         formaction: req.session.formaction,
         funcoptions: req.session.funcoptions,
         imglogo: req.session.imglogo,
         loginname: req.session.loginname,
         username: req.session.username,
         userid: req.session.userid,
         birthdate: req.session.birthdate,
         gemeente: req.session.gemeente,
         orgname: req.session.orgname,
         date: req.session.date,
         message: req.session.message,
         errmessage: req.session.errmessage
       });
     });

   // Set internal date to next month > period += 1
   } else if (req.body.function == "setperiod") {
     args.push(req.session.orgid);
     invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
       if (err) {
         req.session.errmessage = err;
         console.log("app.post setperiod - invoke failed with error: ", err);
       } else {
         req.session.message = "Overgang naar volgende maand was succesvol";
         console.log("app.post setperiod - invoke finished successfully, result: %s", data);
         req.session.period = req.session.period + 1;
         var now = new Date();
         now.setMonth(now.getMonth() + orgdata.period - 1); // Add 'period' months
         req.session.date = now.toLocaleDateString();
       }

       res.render('index', {
         formaction: req.session.formaction,
         funcoptions: req.session.funcoptions,
         imglogo: req.session.imglogo,
         loginname: req.session.loginname,
         username: req.session.username,
         userid: req.session.userid,
         birthdate: req.session.birthdate,
         gemeente: req.session.gemeente,
         orgname: req.session.orgname,
         date: req.session.date,
         message: req.session.message,
         errmessage: req.session.errmessage
       });
       // res.end();
     });

  // ***** Logout Klant
  } else if (req.body.function == "logout") {
       console.log("app.post logout - logout for user %s", req.session.userid);
       req.session.role = null;
       req.session.userid = null;
       req.session.username = null;
       req.session.orgid = null;
       req.session.orgname = null;
       req.session.message = null;
       req.session.errmessage = null;
       return res.redirect(appRoot);    // Force back to home / login page

  } else { // Invalid function > pretty serious
      req.session.message = "ERROR: Functie is niet valide";
      req.session.errmessage = "ERROR: Functie is niet valide";
      console.log("app.post unknown function - invalid function received: ", req.body.function);

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
  }

  }); // End of query.getorgdata

})

// Create a new note and add it to the owners's note queue
function addNote(req, res) {
  console.log('Entered addNote - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid);
  args.push(JSON.stringify({creatorid:req.session.loginid,
                              creatorname:req.session.loginname,
                              title:req.body.title,
                              body:req.body.body}));
  invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      // req.session.errmessage = err;
      req.session.message = 'WAARSCHUWING: Aanmaken bericht in het logboek is niet gelukt';
      console.log("addNote - invoke failed with error: ", err);
    } else {
      if (req.session.message == null) {
        req.session.message = "Aanmaken bericht in het logboek succesvol uitgevoerd";
      }
      console.log("addNote - invoke finished successfully, result: %s", data);
    }

    res.render('index', {
      formaction: req.session.formaction,
      funcoptions: req.session.funcoptions,
      imglogo: req.session.imglogo,
      loginname: req.session.loginname,
      username: req.session.username,
      userid: req.session.userid,
      birthdate: req.session.birthdate,
      gemeente: req.session.gemeente,
      orgname: req.session.orgname,
      date: req.session.date,
      message: req.session.message,
      errmessage: req.session.errmessage
    });
  });
}

// Retrieve events for current user
function getEvents(req, res) {
  console.log('Entered getEvents - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid)
  query(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.message = "Er bestaat geen events lijst voor client";
      req.session.errmessage = err;
      console.log("getEvents - failed to get query data: ", err);

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
    } else {
      // console.log("getEvents - retrieved query data: ", data);
      console.log("getEvents - successfully retrieved events for user %s",
                       req.session.userid);
      evlist = JSON.parse(data);

      res.render('events', {
        title: "Events",
        formaction: req.session.formaction,
        funcoptions: funcArrayEv,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        events: evlist.events
      });
    }
  });
}

// Retrieve notes for current user
function getNotes(req, res) {
  console.log('Entered getNotes - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid)
  query(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.message = "Er zijn geen logboek berichten voor client";
      req.session.errmessage = err;
      console.log("getNotes - failed to get query data: ", err);

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
    } else {
      // console.log("getMessages - retrieved query data: ", data);
      console.log("getNotes - successfully retrieved notes for user %s",
                       req.session.userid);
      noteq = JSON.parse(data);

      res.render('notes', {
        title: "Berichten in logboek",
        formaction: req.session.formaction,
        funcoptions: funcArrayNote,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        notes: noteq.notes
      });
    }
  });
}

// Retrieve the 'Zorgcontract' between Klant (User) and Gemeente (Municipality)
function getContract(req, res) {
  console.log('Entered getContract - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid);
  query(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.message = "Er bestaat nog geen zorgcontract met de gemeente";
      req.session.errmessage = err;
      console.log("getContract - failed to get query data: ", err);

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
    } else {
      // console.log("getContract - retrieved query data: ", data);
      console.log("getContract - successfully retrieved Zorgcontract for user %s", req.session.userid);

      contract = JSON.parse(data);

      res.render('contract', {
        title: "Contract Klant",
        formaction: req.session.formaction,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        budget: contract.budget,
        currency: req.session.currency,
        date: req.session.date,
        zorgvoorziening: contract.zorgvoorziening
      });
    }
  });
}

// Retrieve the 'ZorgWallet' for Klant (User)
function getZorgwallet(req, res) {
  console.log('Entered getZorgwallet - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid);
  query(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.message = "ERROR: Er bestaat nog geen ZorgWallet";
      req.session.errmessage = err;
      console.log("getZorgwallet - failed to get query data: ", err);

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
    } else {
      // console.log("getZorgwallet - retrieved query data: ", data);
      console.log("getZorgwallet - successfully retrieved ZorgWallet for user %s", req.session.userid);
      zorgwallet = JSON.parse(data);

      res.render('zorgwallet', {
        title: "Zorgwallet Klant",
        formaction: req.session.formaction,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        mpb: zorgwallet.mpb,
        totaaleb: zorgwallet.totaaleb,
        date: req.session.date,
        zorg: zorgwallet.zorg
      });
    }
  });
}

// Add a 'Zorgvoorziening' to the 'Zorgcontract'
function addZorgvoorziening(req, res) {
  console.log('Entered addZorgvoorziening - User Id: ', req.session.userid);

  var za = getZorgaanbieder(req.body.agbcode);
  if (!za) {
    console.log('addZorgvoorziening - *SERIOUS FAILURE* failed to get Zorgaanbieder data for AGB code ', req.body.agbcode);
    req.session.message = '*SERIOUS FAILURE* failed to get Zorgaanbieder data for AGB code';
    return res.redirect(appRoot);    // Force back to home / login page
  }
  var zv = getZorgvoorziening(req.body.zorgcode);
  if (!zv) {
    console.log('addZorgvoorziening - *SERIOUS FAILURE* failed to get Zorgvoorziening data for zorgcode ', req.body.zorgcode);
    req.session.message = '*SERIOUS FAILURE* failed to get Zorgvoorziening data for zorgcode';
    return res.redirect(appRoot);    // Force back to home / login page
  }

  var args = [];
  args.push(req.session.userid);
  args.push(JSON.stringify({agbcode:req.body.agbcode, zanaam:za.zanaam, zorgcode:req.body.zorgcode,
               beschrijving:zv.beschrijving, kosten:zv.kosten, eigenbijdrage:zv.eigenbijdrage,
               frequentie:req.body.frequentie}));
  invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.errmessage = err;
      console.log("addZorgvoorziening - invoke failed with error: ", err);
    } else {
      req.session.message = "Toevoegen zorgvoorziening succesvol uitgevoerd";
      console.log("addZorgvoorziening - invoke finished successfully, result: %s", data);
    }

    res.render('index', {
      formaction: req.session.formaction,
      funcoptions: req.session.funcoptions,
      imglogo: req.session.imglogo,
      loginname: req.session.loginname,
      username: req.session.username,
      userid: req.session.userid,
      birthdate: req.session.birthdate,
      gemeente: req.session.gemeente,
      orgname: req.session.orgname,
      date: req.session.date,
      message: req.session.message,
      errmessage: req.session.errmessage
    });
  });
}

// Deliver 'Zorg' to Klant (User)
function deliverZorg(req, res) {
  console.log('Entered deliverZorg - User Id: ', req.session.userid);

  var za = getZorgaanbieder(req.body.agbcode);
  if (!za) {
    console.log('deliverZorg - *SERIOUS FAILURE* failed to get Zorgaanbieder data for AGB code ', req.body.agbcode);
    req.session.message = '*SERIOUS FAILURE* failed to get Zorgaanbieder data for AGB code';
    return res.redirect('/demo');    // Force back to demo home / login page
  }
  var zv = getZorgvoorziening(req.body.zorgcode);
  if (!zv) {
    console.log('deliverZorg - *SERIOUS FAILURE* failed to get Zorgvoorziening data for zorgcode ', req.body.zorgcode);
    req.session.message = '*SERIOUS FAILURE* failed to get Zorgvoorziening data for zorgcode';
    return res.redirect('/demo');    // Force back to demo home / login page
  }

  // Get Zorgcontract to be able to check if deliverd Zorg has been contracted
  var args = [];
  args.push(req.session.userid);
  query(enrollId, req.session.loginid, "getcontract", args, function(err, data) {
    if (err) {
      console.log("deliverZorgg - failed to retrieve Zorgcontract for user %s", req.session.userid);
      // well too bad, not much you can do...
    } else {
      console.log("deliverZorg - successfully retrieved Zorgcontract for user %s", req.session.userid);
      contract = JSON.parse(data);

      var len = contract.zorgvoorziening.length;
      req.session.message = "WAARSCHUWING: Deze zorg valt buiten uw zorgcontract met de gemeente!";
      for (var i = 0; i < len; i++) {
        if (contract.zorgvoorziening[i].zorgcode == req.body.zorgcode) {
          req.session.message = null;
        }
      }
    }

    args = [];
    args.push(req.session.userid);
    args.push(JSON.stringify({agbcode:req.body.agbcode, zanaam:za.zanaam, zorgcode:req.body.zorgcode,
                 beschrijving:zv.beschrijving, datum:req.session.datum, kosten:zv.kosten, eigenbijdrage:zv.eigenbijdrage}));
    invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
      if (err) {
        req.session.errmessage = err;
        console.log("deliverZorg - invoke failed with error: ", err);
      } else {
        if (req.session.message == null) {
          req.session.message = "Levering zorg succesvol uitgevoerd";
        }
        console.log("deliverZorg - invoke finished successfully, result: %s", data);
      }

      res.render('index', {
        formaction: req.session.formaction,
        funcoptions: req.session.funcoptions,
        imglogo: req.session.imglogo,
        loginname: req.session.loginname,
        username: req.session.username,
        userid: req.session.userid,
        birthdate: req.session.birthdate,
        gemeente: req.session.gemeente,
        orgname: req.session.orgname,
        date: req.session.date,
        message: req.session.message,
        errmessage: req.session.errmessage
      });
    }); // end of invoke
  }); // end of query-getcontract
}

// Sign-off (confirm & commit by Klant / User) the delivered 'Zorg'
function signoffZorg(req, res) {
  console.log('signoffZorg - User Id: ', req.session.userid);

  var args = [];
  args.push(req.session.userid);
  invoke(enrollId, req.session.loginid, req.body.function, args, function(err, data) {
    if (err) {
      req.session.errmessage = err;
      console.log("signoffZorg - invoke failed with error: ", err);
    } else {
      req.session.message = "Aftekenen zorg succesvol uitgevoerd";
      console.log("signoffZorg - invoke finished successfully, result: %s", data);
    }

    res.render('index', {
      formaction: req.session.formaction,
      funcoptions: req.session.funcoptions,
      imglogo: req.session.imglogo,
      loginname: req.session.loginname,
      username: req.session.username,
      userid: req.session.userid,
      birthdate: req.session.birthdate,
      gemeente: req.session.gemeente,
      orgname: req.session.orgname,
      date: req.session.date,
      message: req.session.message,
      errmessage: req.session.errmessage
    });
  });
}

// Select a client
function selectUser(req, res) {
   console.log('Entered selectUser - User Id: ', req.body.userid);

   req.session.message = null;
   req.session.errmessage = null;

   var klant = getKlant(req.body.userid);
   if (!klant) {
     console.log('selectUser - *SERIOUS FAILURE* failed to get Klant data for User ID ', req.body.userid);
     req.session.errmessage = '*SERIOUS FAILURE* failed to get Klant data for User ID';
   } else {
     req.session.message = 'Client ' + klant.naam + ' geselecteerd';
   }

   req.session.role = 'user';
   req.session.userid = req.body.userid;   // the user id of the subject (patient)
   req.session.username = klant.naam;
   req.session.birthdate = klant.geboortedatum;
   req.session.gemeente = klant.woonplaats;

   req.session.funcoptions = funcArray;
   req.session.imglogo = "logo.png";

   res.render('index', {
     formaction: req.session.formaction,
     funcoptions: req.session.funcoptions,
     imglogo: req.session.imglogo,
     loginname: req.session.loginname,
     username: req.session.username,
     userid: req.session.userid,
     birthdate: req.session.birthdate,
     gemeente: req.session.gemeente,
     orgname: req.session.orgname,
     date: req.session.date,
     message: req.session.message,
     errmessage: req.session.errmessage
   });
}

// Login handler for client (user)
function login(req, res) {
   console.log('Entered login - User Id: ', req.body.loginid);

   // req.body.password
   req.session.message = null;
   req.session.errmessage = null;

   var klant = getKlant(req.body.loginid);
   if (!klant) {
     console.log('Klant login - *SERIOUS FAILURE* failed to get Klant data for User ID ', req.body.loginid);
     req.session.errmessage = '*SERIOUS FAILURE* failed to get Klant data for User ID';
     return res.redirect(appRoot);    // Force back to home / login page
   }

   req.session.role = 'user';
   req.session.loginid = req.body.loginid;  // the user id logged in
   req.session.userid = req.body.loginid;   // the user id of the subject (patient)
   req.session.loginname = klant.naam;
   req.session.username = klant.naam;
   req.session.birthdate = klant.geboortedatum;
   req.session.gemeente = klant.woonplaats;

   req.session.orgid = "00001"              // Not yet implemented
   req.session.orgname = ""
   req.session.funcoptions = funcArray;
   req.session.imglogo = "logo.png";

   var args = [];

   // Check if a 'Zorgcontract' between Klant (User) and Gemeente exists
   args.push(req.session.userid);
   query(enrollId, req.session.loginid, "checkcontract", args, function(err, data) {
     // NOTE: As it is now, query always returns an address, but possibly of an empty string
     if (err || data == null || data == "") {
       console.log("Klant login checkcontract - contract does not exist for user: %s", req.session.userid);

       // Add a 'Zorgcontract' for the Klant
       var ADDED_ZW = 0;
       args = [];
       args.push(req.session.userid);
       args.push(JSON.stringify({bsn:req.session.userid, klantnaam:req.session.username, gemeente:req.session.gemeente}));
       invoke(enrollId, req.session.loginid, "addcontract", args, function(err, data) {
         if (err) {
           req.session.errmessage = err;
           console.log("Klant login addcontract - invoke failed with error: ", err);
         } else {
           console.log("Klant login addcontract - invoke result: ", data);

           // Also add a 'ZorgWallet' (only when a contract has been added successfully)
           // Prevent this from being called twice, because of 2 callbacks from invoke
           if (!ADDED_ZW) {
             args = [];
             args.push(req.session.userid);
             args.push(JSON.stringify({bsn:req.session.userid, klantnaam:req.session.username, gemeente:req.session.gemeente, mpb:klant.mpb}));
             invoke(enrollId, req.session.loginid, "addzorgwallet", args, function(err, data) {
               if (err) {
                 req.session.errmessage = err;
                 console.log("Klant login addzorgwallet - invoke failed with error: ", err);
               } else {
                 console.log("Klant login addzorgwallet - invoke result: ", data);
                 ADDED_ZW = 1;
               }
             });
           }
         }
       });
     } else {
       // console.log("Klant login checkcontract - contract does exist for user %s - data %s", req.session.userid, data);
       console.log("Klant login checkcontract - contract does exist for user %s", req.session.userid);
     }
   });
}

// I'm listening...
var server = app.listen(listenPort, function () {

   var host = server.address().address;
   var port = server.address().port;

   console.log("I'm listening at http://%s:%s", host, port);

   init();
})

// Get pre-configured Klant data from config.json file
function getKlant(bsn) {
   console.log("Entered getKlant - BSN: ", bsn);

   var klant;

   for (var i = 0; i < configData.klant.length; i++) {
     if (configData.klant[i].bsn == bsn) {
       klant = configData.klant[i];
     }
   }

   return (klant);
}

// Get pre-configured Zorgaanbieder data from config.json file
function getZorgaanbieder(agbcode) {
   console.log("Entered getZorgaanbieder - AGB code: ", agbcode);

   var za;

   for (var i = 0; i < configData.zorgaanbieder.length; i++) {
     if (configData.zorgaanbieder[i].agbcode == agbcode) {
       za = configData.zorgaanbieder[i];
     }
   }

   return (za);
}

// Get pre-configured Zorgvoorziening data from config.json file
function getZorgvoorziening(zorgcode) {
   console.log("Entered getZorgvoorziening - Zorgcode: ", zorgcode);

   var zv;

   for (var i = 0; i < configData.zorgvoorziening.length; i++) {
     if (configData.zorgvoorziening[i].zorgcode == zorgcode) {
       zv = configData.zorgvoorziening[i];
     }
   }

   return (zv);
}

/**********
  invoke

    @argument 1: Chaincode (smart contract) to be invoked
    @argument 2: User to be enrolled for signing
    @argument 3: Function within smart contract to be called
    @argument 4: Function specific parameters
    @argument 5: callback of the form: function(error, invoke_result)
    @return: various returns...

**********/
function invoke(chaincodeId, userId, functionName, args, cb) {

    // Construct the invoke request
    var invokeRequest = {
        // Name (hash) required for invoke
        chaincodeId: chaincodeId,
        // Function to trigger
        fcn: functionName,
        // Parameters for the invoke function
        args: args,
        chainId: channelId,
        txId: tx_id
    };

    var invokeResult;

    console.log("\nEntered invoke - chaincode: %s, user: %s, channel: %s, function: %s, arguments: %j",
                    chaincodeId, userId, invokeRequest.chainId, invokeRequest.fcn, invokeRequest.args);

    // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
    Fabric_Client.newDefaultKeyValueStore({ path: store_path
    }).then((state_store) => {
      console.log("invoke - getting the user context");
    	// assign the store to the fabric client
    	fabric_client.setStateStore(state_store);
    	var crypto_suite = Fabric_Client.newCryptoSuite();
    	// use the same location for the state store (where the users' certificate are kept)
    	// and the crypto store (where the users' keys are kept)
    	var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
    	crypto_suite.setCryptoKeyStore(crypto_store);
    	fabric_client.setCryptoSuite(crypto_suite);

    	// get the enrolled user from persistence, this user will sign all requests
    	return fabric_client.getUserContext(userId, true);

    }).then((user_from_store) => {
      console.log("invoke - about to send invoke transaction proposal");
    	if (user_from_store && user_from_store.isEnrolled()) {
        udata = JSON.parse(user_from_store);
        console.log('invoke - successfully loaded user from store - name: %s, organisation: %s',
                      udata.name, udata.mspid);
    	} else {
    		throw new Error('invoke - failed to get user from persistence - need to register user');
    	}

    	// get a transaction id object based on the current user assigned to fabric client
    	tx_id = fabric_client.newTransactionID();
    	console.log("invoke - assigning transaction_id: ", tx_id._transaction_id);

    	// send the transaction proposal to the peers
      invokeRequest.txId = tx_id;
    	return channel.sendTransactionProposal(invokeRequest);

    }).then((results) => {
    	var proposalResponses = results[0];
    	var proposal = results[1];
    	let isProposalGood = false;
    	if (proposalResponses && proposalResponses[0].response &&
    		proposalResponses[0].response.status === 200) {
    			isProposalGood = true;
    			console.log('invoke - transaction proposal was good');
    		} else {
    			console.error('invoke - transaction proposal was bad');
    		}
    	if (isProposalGood) {
    		console.log(util.format(
    			'invoke - successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
    			proposalResponses[0].response.status, proposalResponses[0].response.message));

    		// build up the request for the orderer to have the transaction committed
    		var request = {
    			proposalResponses: proposalResponses,
    			proposal: proposal
    		};

    		// set the transaction listener and set a timeout of 30 sec
    		// if the transaction did not get committed within the timeout period,
    		// report a TIMEOUT status
    		var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
    		var promises = [];

    		var sendPromise = channel.sendTransaction(request);
    		promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

    		// get an eventhub once the fabric client has a user assigned. The user
    		// is required bacause the event registration must be signed
    		let event_hub = fabric_client.newEventHub();
    		event_hub.setPeerAddr(configData.eventhubConnect);

    		// using resolve the promise so that result status may be processed
    		// under the then clause rather than having the catch clause process
    		// the status
    		let txPromise = new Promise((resolve, reject) => {
    			let handle = setTimeout(() => {
    				event_hub.disconnect();
    				resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
    			}, 3000);
    			event_hub.connect();
    			event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
    				// this is the callback for transaction event status
    				// first some clean up of event listener
    				clearTimeout(handle);
    				event_hub.unregisterTxEvent(transaction_id_string);
    				event_hub.disconnect();

    				// now let the application know what happened
    				var return_status = {event_status : code, tx_id : transaction_id_string};
    				if (code !== 'VALID') {
    					console.error('invoke - transaction was invalid, code = ' + code);
    					resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
    				} else {
    					console.log('invoke - transaction has been committed on peer ' + event_hub._ep._endpoint.addr);
    					resolve(return_status);
    				}
    			}, (err) => {
    				//this is the callback if something goes wrong with the event registration or processing
    				reject(new Error('invoke - there was a problem with the eventhub ::'+err));
    			});
    		});
    		promises.push(txPromise);

    		return Promise.all(promises);
    	} else {
    		console.error('invoke - failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
    		throw new Error('invoke - failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
    	}
    }).then((results) => {
    	console.log('invoke - send transaction promise and event listener promise have completed');
    	// check the results in the order the promises were added to the promise all list
    	if (results && results[0] && results[0].status === 'SUCCESS') {
    		console.log('invoke - successfully sent transaction to the orderer.');
    	} else {
    		console.error('invoke - failed to order the transaction. Error code: ' + response.status);
    	}

    	if(results && results[1] && results[1].event_status === 'VALID') {
    		console.log('invoke - successfully committed the change to the ledger by the peer');
        invokeResult = JSON.stringify(results);
        cb(null, invokeResult);
    	} else {
    		console.log('invoke - transaction failed to be committed to the ledger due to ::' + results[1].event_status);
        cb(results[1]);
    	}
    }).catch((err) => {
    	console.error('invoke - failed to invoke successfully :: ' + err);
      cb(err);
    });

    console.log("invoke exit - function: %s", invokeRequest.fcn);
}

/**********
  query

    @argument 1: Chaincode (smart contract) to be queried
    @argument 2: User to be enrolled for signing
    @argument 3: Function within smart contract to be called
    @argument 4: Function specific parameters
    @argument 5: callback of the form: function(error, invoke_result)
    @return: various returns...

**********/
function query(chaincodeId, userId, functionName, args, cb) {

    // Construct the query request
    var queryRequest = {
        // Name (hash) required for query
        chaincodeId: chaincodeId,
        // Function to trigger
        fcn: functionName,
        // Existing state variable to retrieve
        args: args
    };

    var queryResponse;

    console.log("\nEntered query - chaincode: %s, user: %s, function: %s, arguments: %j",
                    chaincodeId, userId, queryRequest.fcn, queryRequest.args);

    // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
    Fabric_Client.newDefaultKeyValueStore({ path: store_path
    }).then((state_store) => {
      console.log("query - getting the user context");
      // assign the store to the fabric client
    	fabric_client.setStateStore(state_store);
    	var crypto_suite = Fabric_Client.newCryptoSuite();
    	// use the same location for the state store (where the users' certificate are kept)
    	// and the crypto store (where the users' keys are kept)
    	var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
    	crypto_suite.setCryptoKeyStore(crypto_store);
    	fabric_client.setCryptoSuite(crypto_suite);

    	// get the enrolled user from persistence, this user will sign all requests
    	return fabric_client.getUserContext(userId, true);

    }).then((user_from_store) => {
      console.log("query - about to send query request");
    	if (user_from_store && user_from_store.isEnrolled()) {
        udata = JSON.parse(user_from_store);
        console.log('query - successfully loaded user from store - name: %s, organisation: %s',
                      udata.name, udata.mspid);
    	} else {
    		throw new Error('query - failed to get user from persistence - need to register user');
    	}

    	// send the query proposal to the peer
    	return channel.queryByChaincode(queryRequest);

    }).then((query_responses) => {
    	console.log("query - query has completed, checking responses");
    	// query_responses could have more than one  results if there multiple peers were used as targets
    	if (query_responses && query_responses.length == 1) {
    		if (query_responses[0] instanceof Error) {
    			console.error("query - error from query = ", query_responses[0]);
          cb(query_responses[0]);
    		} else {
    			console.log("query - response is ", query_responses[0].toString());
          cb(null, query_responses[0].toString());
    		}
    	} else {
    		console.log("query - no payloads were returned from query");
    	}
    }).catch((err) => {
    	console.error('query - failed to query successfully :: ' + err);
      queryResponse = JSON.stringify(err);
      console.log("query - failed to query chaincode, function - request: %j, error: %j", queryRequest, err);
      cb(err);
    });

    console.log("query exit - function: %s", queryRequest.fcn);
}

/**********
  init zwallet

    NOTE: Chaincode should already have been deployed and
          admin and users enrolled and registered

**********/
function init() {
    console.log("Entered init zwallet");

    // Get configuration and fixed data
    try {
        configData = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
    } catch (err) {
        console.log("init zwallet - config.json is missing or invalid file")
        process.exit();
    }

    // Set the configuration parameters
    listenPort = configData.listenport;
    appRoot = configData.approot;
    enrollId = configData.enrollid;
    channelId = configData.channelid;
    dbName = configData.dbname;

    console.log("init zwallet - listening port: %d, app root: %s, enroll Id: %s, channel Id: %s, dbase: %s",
                  listenPort, appRoot, enrollId, channelId, dbName);

    // Connect to database
    db = tdb.connectDB(dbName);
    tdb.listDB(); // List all existing databases

    // setup the fabric network
    fabric_client = new Fabric_Client();

    channel = fabric_client.newChannel(channelId);
    peer = fabric_client.newPeer(configData.peerConnect);
    console.log("init zwallet - new peer object: %j", peer);
    channel.addPeer(peer);

    order = fabric_client.newOrderer(configData.ordererConnect);
    console.log("init zwallet - new orderer object: %j", order);
    channel.addOrderer(order);

    var tx_id = null;
    store_path = path.join(__dirname, 'hfc-key-store');
    console.log('init zwallet - store path:' + store_path);

    var args = [];    // Quick test sending (dummy) query to chaincode
    args.push('00001');
    query(enrollId, 'user1', "getorgdata", args, function(err, data) {
      if (err) {
        console.log("init zwallet - getorgdata query failed with error: ", err);
      } else {
        console.log("init zwallet - getorgdata query finished successfully");
      }
    });
}
