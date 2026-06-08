export interface CardDrop {
    cardName:   string;  // from Set_contains e.g. "Sevens Road Magician"
    cardNumber: string;  // e.g. "RD/5TH1-JP001"
    rarity:     string;  // e.g. "Ultra Rare"
    imgUrl:     string | null;
}

export interface PackOpeningResult {
    packName: string;
    cards:    CardDrop[];
}