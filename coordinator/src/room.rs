// Room defintions and its ENUMS

use std::collections::HashMap;

use uuid::Uuid;

pub enum RoomStatus {
    Active,
    Closed,
}

pub struct Room {
    pub room_id: Uuid,
    pub room_token: String,
    pub client_token: String,
    pub status: RoomStatus,
}

impl Room {
    pub fn new(
        room_id: Uuid,
        room_token: String,
        client_token: String,
        status: RoomStatus,
    ) -> Self {
        Self {
            room_id: room_id,
            room_token,
            client_token,
            status,
        }
    }
}

pub struct RoomTable {
    pub rooms: HashMap<String, Room>, // client_token to Room
}

impl RoomTable {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }

     // Add or update a room
    pub fn insert(&mut self, client_token: String, room: Room) {
        self.rooms.insert(client_token, room);
    }

    // Get a read-only reference to a room
    pub fn get(&self, client_token: &str) -> Option<&Room> {
        self.rooms.get(client_token)
    }

    // Get a mutable reference to a room (to modify its properties)
    pub fn get_mut(&mut self, client_token: &str) -> Option<&mut Room> {
        self.rooms.get_mut(client_token)
    }

    // Remove a room from the table
    pub fn remove(&mut self, client_token: &str) -> Option<Room> {
        self.rooms.remove(client_token)
    }
}
