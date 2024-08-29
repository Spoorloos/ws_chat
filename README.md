# Websocket Chatrooms

This is a simple websocket chatroom website I built using Bun and websockets during my time off from school to learn more about end to end encryption and just as a way to entertain myself.

Login Page | Chat Page
--- | ---
![](imgs/login_page.png) | ![](imgs/chat_page.png)

## Features

- **End-to-End Encryption**: Messages are encrypted before being sent and can only be decrypted by the recipients.
- **Real-Time Communication**: Using websockets for real time messaging.
- **Simple UI**: A (very) minimal and easy-to-use interface.

## Setup

### Prerequisites

- Make sure you have [bun](https://bun.sh/) installed of course.

### Getting Started

1. Clone the repository.
2. Place your SSL certificates in the [certs/](certs/) folder if you have any. (The website will not function properly over HTTP)
3. Change the passphrase and file names of your certificates in [.env](.env) if needed.
4. Run the following commands inside a terminal in the folder:
```bash
bun install
```
```
bun run start
```

## Contributions

Contributions are again very much welcome! Please fork the repository and create a pull request for any changes you'd like to make.
