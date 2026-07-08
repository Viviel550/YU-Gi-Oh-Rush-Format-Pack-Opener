export interface BoosterPack {
    id:        string;
    title:     string;
    url:       string;
    imgUrl:    string | null;
    timestamp: number;
    region: 'JP' | 'KR' | null;
    prefix:    string;
    medium:    string | null;
}
