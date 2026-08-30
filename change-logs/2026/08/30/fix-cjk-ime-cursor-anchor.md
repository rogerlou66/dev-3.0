Short: Keep IME beside terminal cursor

Fixed Chinese, Japanese, and Korean input composition appearing at the terminal's top-left corner, and punctuation or spaces being dropped when they committed a composition. The hidden terminal input now follows the live cursor, owns focus, and replays the composition-ending key after the composed text reaches the terminal.
