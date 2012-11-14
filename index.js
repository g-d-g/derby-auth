var passport = require('passport'),
    LocalStrategy = require('passport-local').Strategy,
    savedStrageties = {},
    _  = require('lodash'),
    model, request;

/**
 * Creates middleware which provides authentication for DerbyJS
 * @param expressApp
 * @param {store} Racer store, used for configuring queries and accessControl
 * @param {strategies} A hash of strategy objects and their configurations. See https://github.com/lefnire/derby-examples/blob/master/authentication/src/server/index.coffee
 */
module.exports.middleware = function(expressApp, store, strategies) {
    // Setup queries & accessControl
    require('./lib/store')(store);

    // Must be called before passport middleware so they have access to model
    expressApp.use(function(req, res, next) {
        request = req;
        model = req.getModel();

        // New User - They get to play around before creating a new account.
        var sess = model.session;
        if (!sess.userId) {
            sess.userId = model.id();
            model.set("users." + sess.userId, {
                auth: {}
            });
        }
        return next();
    });

    // Initialize Passport.  Also use passport.session() middleware, to support
    // persistent login sessions (recommended).
    savedStrategies = strategies; // keep around in module closure for future use by routes()
    setupPassport(strategies);
    expressApp.use(passport.initialize());
    expressApp.use(passport.session());
    return function(req,res,next){next()}
};

/**
 * Sets up static routes for Derby app. Normally this wouldn't be necessary, would just place this logic
 * in middelware() setup. However, it breaks Derby routes - so we need this to call separately after expressApp
 * hass been initialized
 */
module.exports.routes = function(expressApp) {
    // POST /login
    //   Use passport.authenticate() as route middleware to authenticate the
    //   request.  If authentication fails, the user will be redirected back to the
    //   login page.  Otherwise, the primary route function function will be called,
    //   which, in this example, will redirect the user to the home page.
    //
    //   curl -v -d "username=bob&password=secret" http://127.0.0.1:3000/login
    expressApp.post('/login',
        passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
        function(req, res) {
            res.redirect('/');
        }
    );

    // POST /login
    //   This is an alternative implementation that uses a custom callback to
    //   acheive the same functionality.
    /*
     app.post('/login', function(req, res, next) {
         passport.authenticate('local', function(err, user, info) {
            if (err) { return next(err) }
            if (!user) {
                req.flash('error', info.message);
                return res.redirect('/login')
            }
            req.logIn(user, function(err) {
            if (err) { return next(err); }
                return res.redirect('/users/' + user.username);
            });
         })(req, res, next);
     });
     */

    expressApp.post('/register', function(req, res){
        model = req.getModel();

        // if user already registered, return
        if (model.get('users.' + model.session.userId + '.auth.local')) {
            return res.redirect('/');
        }

        var q = model.query('users').withUsername(req.body.username);
        model.fetch(q, function(err, users){
            var userObj = getUserObj(users, {err: err});
            if (userObj) {
                // user already registered with that name, TODO send error message
                return res.redirect('/login');
            } else {
                // Legit, register
                model.set('users.' + model.session.userId + '.auth.local', req.body);
                return res.redirect('/');
            }
        });
    });

    _.each(savedStrategies, function(strategy, name){
        // GET /auth/facebook
        //   Use passport.authenticate() as route middleware to authenticate the
        //   request.  The first step in Facebook authentication will involve
        //   redirecting the user to facebook.com.  After authorization, Facebook will
        //   redirect the user back to this application at /auth/facebook/callback
        expressApp.get('/auth/'+name,
            passport.authenticate(name),
            function(req, res){
                // The request will be redirected to Facebook for authentication, so this
                // function will not be called.
            });

        // GET /auth/facebook/callback
        //   Use passport.authenticate() as route middleware to authenticate the
        //   request.  If authentication fails, the user will be redirected back to the
        //   login page.  Otherwise, the primary route function function will be called,
        //   which, in this example, will redirect the user to the home page.
        expressApp.get('/auth/' + name + '/callback',
            passport.authenticate(name, { failureRedirect: '/login' }),
            function(req, res) {
                res.redirect('/');
            });
    });

    expressApp.get('/logout', function(req, res){
        req.session.userId = undefined;
        req.logout();
        res.redirect('/');
    });

    // Simple route middleware to ensure user is authenticated.
    //   Use this route middleware on any resource that needs to be protected.  If
    //   the request is authenticated (typically via a persistent login session),
    //   the request will proceed.  Otherwise, the user will be redirected to the
    //   login page.
    //    function ensureAuthenticated(req, res, next) {
    //        if (req.isAuthenticated()) { return next(); }
    //        res.redirect('/login')
    //    }
}

function setupPassport(strategies) {
    // Passport session setup.
    //   To support persistent login sessions, Passport needs to be able to
    //   serialize users into and deserialize users out of the session.  Typically,
    //   this will be as simple as storing the user ID when serializing, and finding
    //   the user by ID when deserializing.
    passport.serializeUser(function(user, done) {
        done(null, user.id);
    });

    passport.deserializeUser(function(id, done) {
        var q = model.query('users').withId(id);
        model.fetch(q, function(err, users) {
            var userObj = getUserObj(users, {err: err});
            if (err) return done(err);
            if (!userObj && !err) return done(new Error('User not found'));
            return done(null, userObj);
        });
    });

    // Use the LocalStrategy within Passport.
    //   Strategies in passport require a `verify` function, which accept
    //   credentials (in this case, a username and password), and invoke a callback
    //   with a user object.  In the real world, this would query a database;
    //   however, in this example we are using a baked-in set of users.
    passport.use(new LocalStrategy(
        function(username, password, done) {
            // asynchronous verification, for effect...
            process.nextTick(function () {

                // Find the user by username.  If there is no user with the given
                // username, or the password is not correct, set the user to `false` to
                // indicate failure and set a flash message.  Otherwise, return the
                // authenticated `user`.
                var q = model.query('users').withLogin(username, password);
                return model.fetch(q, function(err, users) {
                    var userObj = getUserObj(users, {err: err});
                    if (err) return done(err);
                    if (!userObj) return done(null, false, { message: 'Invalid login' });

                    // Success
                    model.session.userId = userObj.id;
                    return done(null, userObj);
                });
            });
        }
    ));

    _.each(strategies, function(obj, name){

        // Provide default values for options not passed in
        // TODO pass in as conf URL variable
        _.defaults(obj.conf, {callbackURL: "http://localhost:3000/auth/" + name + "/callback"})

        // Use the FacebookStrategy within Passport.
        //   Strategies in Passport require a `verify` function, which accept
        //   credentials (in this case, an accessToken, refreshToken, and Facebook
        //   profile), and invoke a callback with a user object.
        passport.use(new obj.strategy(obj.conf, function(accessToken, refreshToken, profile, done) {
                // asynchronous verification, for effect...
                process.nextTick(function () {

                    // To keep the example simple, the user's Facebook profile is returned to
                    // represent the logged-in user.  In a typical application, you would want
                    // to associate the Facebook account with a user record in your database,
                    // and return that user instead.
                    var q = model.query('users').withProvider(profile.provider, profile.id);
                    model.fetch(q, function(err, users) {
                        var userObj = getUserObj(users, {err: err, profile: profile});
                        // # Has user been tied to facebook account already?
                        if (!userObj) {
                            var userPath = "users." + model.session.userId;
                            model.setNull(userPath + '.auth', {});
                            model.set(userPath + '.auth.' + profile.provider, profile);
                            userObj = model.get(userPath);
                        } else {
                            model.session.userId = userObj.id;
                        }
                        return done(null, userObj);
                    });
                });
            }
        ));
    });
};

/**
 * Util function, parses user query result and optionally console.logs() a second param
 */
function getUserObj(users, logObj){
    var userObj, u;
    userObj = users && (u = users.get()) && u.length > 0 && u[0];
    if (logObj) {
        _.defaults(logObj, {userObj:userObj});
        console.log(logObj);
    }
    return userObj;
}