export default class TokenStore {
  constructor() {
    const context = {
      instance: this,
      token: null
    };

    this.store = this.store.bind(context);
    this.getHeader = this.getHeader.bind(context);
  }

  store(token = null) {
    this.token = token;
    console.log(`TokenStore~store: Token stored.`);
  }

  getHeader(connection) {
    // in future this method will get the correct token (or none) for the given url
    return { "Authentication": `Bearer: ${this.token}`};
  }
}
