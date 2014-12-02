'use strict';

/**
 * The station service will keep track of the current station (if started)
 * This means that it will enable/disable functions in the player and check when a new song has to be loaded
 */

angular.module('mopify.services.station', [
    'angular-echonest',
    'mopify.services.mopidy',
    'mopify.services.crossdomainoauth',
    "spotify"
])
.factory("stationservice", function($rootScope, $q, $timeout, Echonest, mopidyservice, Spotify, localStorageService, crossdomainoauth){

    var stationPlaying = false;
    var echonestTracksQueue = [];
    
    function processMopidyTracklist(){
        var TRACKSPERBATCH = 10;
        var deferred = $q.defer();

        // The reponse from echonest only contains the artist name and track title. We need to look up the tracks in mopidy and add them
        // This is done in batches to prevent mopidy from overloading
        if(echonestTracksQueue.length > 0){
            generateMopidyTracks(TRACKSPERBATCH).then(function(tracks){
                addTracksToMopidy(tracks).then(function(response){
                    $timeout(processMopidyTracklist, 5000);

                    deferred.resolve(response);
                });
            });
        }

        return deferred.promise;
    };

    function generateMopidyTracks(number){
        // Get tracks from array
        var batch = echonestTracksQueue.splice(0, number);
        var mopidytracks = [];
        var done = 0;

        var deferred = $q.defer();

        for(var x = 0; x < batch.length; x++){
            var track = batch[x];

            mopidyservice.searchTrack(track.artist_name, track.title).then(function(data){
                done++;

                if(data[0].tracks){
                    var mopidytrack = data[0].tracks[0];
                    mopidytracks.push(mopidytrack);
                }

                if(done == number){
                    deferred.resolve(mopidytracks);
                }
            });

        }

        return deferred.promise;
        
    };

    function addTracksToMopidy(tracks){
        return mopidyservice.addToTracklist({ tracks: tracks});
    }

    /**
     * Prepare the parameters that have to be send to Echonest
     * @param  {station} station - object from the stations controller containing the information for the new radio
     * @return {$q.defer} 
     */
    function prepareParameters(station){
        var parameters = {
            results: 50,
            bucket: 'id:spotify',
            limit: true
        };

        var deferred = $q.defer();

        if(station.type == "artist"){
            parameters.artist = station.name;
            parameters.type = "artist-radio";

            deferred.resolve(parameters);
        }
        
        if(station.type == "track"){
            parameters.song_id = station.spotify.uri;
            parameters.type = "song-radio";

            deferred.resolve(parameters);
        }

        if(station.type == "album" || station.type == "user"){
            parameters.type = "song-radio";

            if(station.spotify.tracks == undefined){
                Spotify.getAlbum(station.spotify.id).then(function (data) {
                    parameters.song_id = createTrackIdsList(data.tracks);

                    deferred.resolve(parameters);
                });
            }
            else{
                parameters.song_id = createTrackIdsList(station.spotify.tracks);
                deferred.resolve(parameters);
            }
        }

        return deferred.promise;
    };

    function createTrackIdsList(tracks){
        var tracks = tracks.items.splice(0, 4);
        var trackids = [];

        for(var x = 0; x < tracks.length;x++){
            if(tracks[x].uri == undefined)
                trackids.push(tracks[x].track.uri);
            else
                trackids.push(tracks[x].uri);
        }

        return trackids;
    }

    /**
     * Create the new station using Echonest
     * @param  {station} station - object from the stations controller containing the information for the new radio
     */
    function createStation(station){
        // Get the songs from Echonest
        prepareParameters(station).then(function(parameters){

            Echonest.playlist.static(parameters).then(function(songs){
                echonestTracksQueue = songs;

                mopidyservice.clearTracklist().then(function(){
                    processMopidyTracklist().then(function(){
                        mopidyservice.playTrackAtIndex(0);
                    });
                });
            }); 
        });
    };

    function getSpotifyObject(uri){
        var urisplitted = uri.split(":");
        var deferred = $q.defer();

        switch(urisplitted[1]){
            case "artist":
                Spotify.getArtist(urisplitted[2]).then(function(data){
                    deferred.resolve(data);
                });
                break;
            case "track":
                Spotify.getTrack(urisplitted[2]).then(function(data){
                    deferred.resolve(data);
                });
                break;
            case "album":
                Spotify.getAlbum(urisplitted[2]).then(function(data){
                    deferred.resolve(data);
                });
                break;
            case "user":
                // If the case is user it means we have to check a user's playlist, which involes getting permission from the user
                if(localStorage.getItem("spotify-token") == null)
                    Spotify.login();

                // Our nifty service makes sure that we can get an users key, dispite the fact that his url isn't in the callbackuri
                crossdomainoauth.waitForKey().then(function(data){
                    // Save and set token
                    localStorage.setItem('spotify-token', data);
                    Spotify.setAuthToken(data);

                    Spotify.getPlaylist(urisplitted[2], urisplitted[4]).then(function (data) {
                        data.images = data.tracks.items[0].track.album.images;

                        deferred.resolve(data);
                    });
                });
                break;
        }

        return deferred.promise;
    };

    return {
        init: function(){},
        
        start: function(station){
            createStation(station);
        },

        startFromSpotifyUri: function(uri){
            var urisplitted = uri.split(":");
            var deferred = $q.defer();

            getSpotifyObject(uri).then(function(data){
                var station = {
                    type: urisplitted[1],
                    spotify: data,
                    name: data.name,
                    coverImage: (data.images == undefined) ? data.album.images[1].url : data.images[1].url,
                    started_at: Date.now()
                };
                
                // Save the new station
                var allstations = localStorageService.get("stations");
                allstations.push(station);
                localStorageService.set("stations", allstations);

                createStation(station);                

                return deferred.resolve(station);
            });

            return deferred.promise;
        }
    };
});