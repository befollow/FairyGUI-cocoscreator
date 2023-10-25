/*
 * @Author: f.zohar 
 * @Date: 2021-06-28 15:42:00 
 * @Last Modified by: f.zohar
 * @Last Modified time: 2021-06-30 17:02:20
 * 遵循谁用谁释放
 * 用 queryObjects(cc.Texture2D) 查看释放
 * cc.assetManager 查看资源缓存
 * Prefdog 工具查看Android平台性能
 * chome调试
 */
import { Asset, AssetManager, assetManager, Component, director, error, js, log, macro, resources, Sprite, SpriteFrame, sys, warn, _decorator, ISchedulable, Scheduler } from "cc";
import { DEBUG } from "cc/env";
const scheduler = director.getScheduler();

/**暂停加载队列 */
var pauseLoadQueen: boolean = false;
export class ResManager implements ISchedulable {
    id?: string;
    uuid?: string;
    /**加载队列 */
    private _loadQueen: Array<{
        path: string, bundleName: string, target: Component,
        cb: (res: Asset) => void, type: typeof Asset
    }> = [];

    private static _inst: ResManager;
    public static get inst(): ResManager {
        if (!ResManager._inst)
            ResManager._inst = new ResManager();
        return ResManager._inst;
    }

    constructor() {
        Scheduler.enableForTarget(this);
        this.schedule(this.checkLoad);
        this.schedule(this.onTickClear, 1, macro.REPEAT_FOREVER, 1);
    }

    protected schedule(callback: any, interval?: number, repeat: number = macro.REPEAT_FOREVER, delay: number = 0) {
        const paused = scheduler.isTargetPaused(this);
        return scheduler.schedule(callback, this, interval, repeat, delay, paused);
    }

    private onTickClear(dt: number) {
        Loader.inst.onTickClear(dt)
    }

    /**检查需要加载的 */
    private checkLoad() {
        this._checkLoad();
    }
    private _checkLoad() {
        if (this._loadQueen.length <= 0) {
            return;
        }
        /**等当前的完成 */
        if (pauseLoadQueen) {
            return;
        }
        let loadPrama = this._loadQueen.shift();
        if (!loadPrama.target || !loadPrama.target.isValid) {
            this.checkLoad();
            return;
        }
        pauseLoadQueen = true;
        this.loadRes(loadPrama.path, loadPrama.bundleName, loadPrama.target, loadPrama.cb, loadPrama.type)
    }

    /**
     * 是否存在该资源
     * @param path 
     * @param bundleName 
     * @returns 
     */
    public isExist(path: string, bundleName: string = "resources") {
        const bundle = assetManager.getBundle(bundleName);
        if (!bundle) {
            return false;
        }
        if (bundle.getInfoWithPath(path)) {
            return true;
        }
        return false;
    }

    // 解析路径.path: "candy://home/HomeWindow"
    public parsePath(path: string) {
        let url = path.substring(path.indexOf("://") + 3)
        let bundle = path.substring(0, path.indexOf("://"))
        return { path: url, bundle: bundle }
    }

    /**
     * 获取Bundle
     * @param name 
     * @returns 
     */
    public getBundle(name: string): Promise<AssetManager.Bundle> {
        if (!name || name.length == 0 || name == "resources") return Promise.resolve(resources);
        const bundle = assetManager.getBundle(name)
        if (bundle) {
            return Promise.resolve(bundle);
        }
        return new Promise<AssetManager.Bundle>(resolve => {
            assetManager.loadBundle(name, (err, bundle) => {
                if (err) {
                    error("======加载bundle失败", err)
                    return resolve(null)
                }
                return resolve(bundle)
            });
        })
    }

    /**
     * 排队一个一个加载，避免拥堵卡顿
     */
    public syncLoadRes(path: string, bundleName: string = "resources", target: any, cb: (res: Asset) => void, type: typeof Asset) {
        // 找到直接返回，不用排队
        const isFind = Loader.inst.isFindInCache(path, bundleName, target, cb, type);
        if (isFind) {
            return;
        }

        this._loadQueen.push({ path: path, bundleName: bundleName, target: target, cb: cb, type: type });
    }

    public syncLoadResByUri(uri: string, target: any, cb: (res: Asset) => void, type: typeof Asset) {
        const meta = this.parsePath(uri);
        return this.syncLoadRes(meta.path, meta.bundle, target, cb, type);
    }

    /**
     * 加载资源
     * target 销毁时引用计数-1,并尝试释放
     * @param path string
     * @param bundle string
     * @param target 使用目标 
     * @param cb (res: cc.Asset) => void **target存在则必定会有回调
     */
    public loadRes(path: string, bundleName: string = "resources", target: any, cb: (res: Asset) => void, type: typeof Asset) {
        return Loader.inst.loadRes(path, bundleName, target, cb, type);
    }

    public loadResByUri(uri: string, target: any, cb: (res: Asset) => void, type: typeof Asset) {
        const meta = this.parsePath(uri);
        return Loader.inst.loadRes(meta.path, meta.bundle, target, cb, type);
    }

    /**
     * 释放资源
     */
    public releaseRes(path: string, bundleName: string = "resources", type: typeof Asset, clear: boolean = false) {
        const resid = Loader.inst.genResId(path, bundleName, type);
        Loader.inst.releaseRes(resid, clear);
    }

    public setSprite(sprite: Sprite, bundleName: string, assetName: string, target: any = null) {
        if (!assetName.endsWith("/spriteFrame")) {
            assetName += "/spriteFrame";
        }
        return new Promise((resolve) => {
            this.loadRes(assetName, bundleName, target, (res: Asset) => {
                if (res && sprite.node && sprite.node.isValid) {
                    sprite.spriteFrame = res as SpriteFrame;
                }
                return resolve(0);
            }, SpriteFrame);
        });
    }

    public setSpriteSync(sprite: Sprite, bundleName: string, assetName: string, target: any = null) {
        if (!assetName.endsWith("/spriteFrame")) {
            assetName += "/spriteFrame";
        }
        return new Promise((resolve) => {
            this.syncLoadRes(assetName, bundleName, target, (res: Asset) => {
                if (res && sprite.node && sprite.node.isValid) {
                    sprite.spriteFrame = res as SpriteFrame;
                }
                return resolve(0);
            }, SpriteFrame);
        });
    }

}

class ResHandler {
    // 保留时间（10s后释放）
    private readonly _holdTime = 10;
    // 释放时间
    private _decTimes: number[] = [];

    bundleName: string;
    path: string;
    type: typeof Asset;
    // 记录动态引用次数
    count: number = 0;

    private _loading = false;
    // 监听函数
    private _cbs: Array<(res: Asset) => void> = [];

    constructor(path: string, bundleName: string = "resources", type: typeof Asset) {
        this.bundleName = bundleName;
        this.path = path;
        this.type = type;

        this.init();
    }

    private init() {
        this.count = 0;

    }

    /**
     * 路径是否存在该资源
     * @returns 
     */
    public isExist() {
        const bundle = assetManager.getBundle(this.bundleName);
        if (!bundle) {
            return false;
        }
        if (bundle.getInfoWithPath(this.path)) {
            return true;
        }
        return false;
    }

    get id() {
        return this.bundleName + "://" + this.path + "/" + this.typeClsName;
    }

    get uri() {
        return this.bundleName + "://" + this.path;
    }

    get typeClsName() {
        return js.getClassName(this.type.prototype);
    }

    // 解析路径.path: "candy://home/HomeWindow"
    public parsePath(path: string) {
        let url = path.substring(path.indexOf("://") + 3)
        let bundle = path.substring(0, path.indexOf("://"))
        return { path: url, bundle: bundle }
    }

    public addRef() {
        const res = this.Res;
        res && res.addRef();
        this.count++;
    }

    /**
     * 延时释放
     * @param clear 
     */
    public delayDecRef(clear: boolean = false) {
        if (this.count <= 0) {
            return;
        }
        let ts = Date.now() + this._holdTime * 1000;
        this._decTimes.push(ts);
        this.count--;
        if (clear) {
            while (this.count > 0) {
                this.delayDecRef();
            }
        }
    }

    /**
     * 检查释放时间
     * @param now 
     */
    public checkRelease(now: number) {
        for (let i = 0; i < this._decTimes.length; i++) {
            const ts = this._decTimes[i];
            if (ts >= 0 && now > ts) {
                this._decTimes.splice(i, 1);
                i--;
                this.decRef();
            }
        }
    }

    /**
     * 减少引用计数
     */
    public decRef() {
        const res = this.Res;
        // const bundle = assetManager.getBundle(this.bundleName);
        // switch (this.type) {
        //     case sp.SkeletonData:
        //         {
        //             let asset_png = bundle.get(this.path, ImageAsset);
        //             if (asset_png && asset_png.refCount > 0) {
        //                 asset_png.decRef();
        //             }
        //         }
        //         break;

        //     default:
        //         break;
        // }
        res && res.decRef();
        this.release();
    }

    // 立即释放
    public destory() {
        while (this.count > 0) {
            this.decRef();
            this.count--;
        }
        this._decTimes = [];
        this.release();
    }

    // 释放逻辑
    public release() {
        const res = this.Res;
        if (!res) {
            return;
        }
        if (this._decTimes.length <= 0) {
            this._cbs = [];
            this._loading = false;
            this.count = 0;
        }

        // 
        if (res.refCount <= 0) {
            const bundle = assetManager.getBundle(this.bundleName);
            bundle.release(this.path);
            log(`Fairygui释放了资源【${this.id}】`);
        } else {
            // log(`【${this.id}】,保留静态引用次数${res.refCount}`);
        }


    }

    public addListener(cb: (res: Asset) => void) {
        const res = this.Res;
        if (res) {
            cb(res);
        } else {
            this._cbs.push(cb);
        }
    }

    public load() {
        const res = this.Res;
        if (res) {
            return;
        }
        if (this._loading) {
            return;
        }
        this._loading = true;
        DEBUG && console.time("Fairygui加载【" + this.id + "】");
        this.getBundle(this.bundleName).then((bundle: AssetManager.Bundle) => {
            // 加载回调
            const loadComplete = (err: any, res: Asset) => {
                DEBUG && console.timeEnd("Fairygui加载【" + this.id + "】");
                this._loading = false;
                if (err) {
                    console.warn("Fairygui资源加载失败:" + this.id);
                    this._cbs.forEach(element => {
                        element(null);
                    });
                } else {
                    this._cbs.forEach(element => {
                        element(res);
                    });
                }
            }
            if (this.type) {
                bundle.load(this.path, this.type, loadComplete);
            } else {
                bundle.load(this.path, loadComplete);
            }
        });
    }

    public get Res() {
        const bundle = assetManager.getBundle(this.bundleName);
        if (bundle) {
            const asset = bundle.get(this.path, this.type);
            if (asset && asset.isValid) {
                return asset;
            }
        }
        return null;
    }

    /**
     * 获取Bundle
     * @param name 
     * @returns 
     */
    public getBundle(name: string): Promise<AssetManager.Bundle> {
        if (!name || name.length == 0 || name == "resources") return Promise.resolve(resources);
        const bundle = assetManager.getBundle(name)
        if (bundle) {
            return Promise.resolve(bundle);
        }
        return new Promise<AssetManager.Bundle>(resolve => {
            assetManager.loadBundle(name, (err, bundle) => {
                if (err) {
                    console.error("Fairygui加载bundle失败！", err)
                    return resolve(null)
                }
                return resolve(bundle)
            });
        })
    }


}
// export const pipeline = new AssetManager.Pipeline('normal load', []);
// export type CompleteCallbackNoData = (err?: Error | null) => void;
// pipeline.append(preprocess).append(load);
class Loader {
    private resMap: { [key: string]: ResHandler } = {};

    private static _instance: Loader;
    public static get inst(): Loader {
        if (Loader._instance == null) {
            Loader._instance = new Loader();
        }
        return Loader._instance;
    }

    public genResId(path: string, bundleName: string = "resources", type: typeof Asset) {
        return bundleName + "://" + path + "/" + js.getClassName(type);
    }

    private getResHandler(path: string, bundleName: string = "resources", type: typeof Asset): ResHandler {
        const resid = this.genResId(path, bundleName, type);
        if (!this.resMap[resid]) {
            this.resMap[resid] = new ResHandler(path, bundleName, type);
        }
        return this.resMap[resid];
    }

    public isFindInCache(path: string, bundleName: string = "resources", target: any, cb: (res: Asset) => void, type: typeof Asset) {
        const resh = this.getResHandler(path, bundleName, type);
        if (resh.Res) {
            Loader.inst.cacheRes(target, resh);
            cb && cb.call(target, resh.Res);
            return true
        }
        return false;
    }

    public loadRes(path: string, bundleName: string = "resources", target: any, cb: (res: Asset) => void, type: typeof Asset) {
        const resh = this.getResHandler(path, bundleName, type);
        resh.addListener((res: Asset) => {
            if (target && target.isValid) {
                Loader.inst.cacheRes(target, resh);
                cb && cb.call(target, res);
            } else {
                cb = null;
                warn(`Fairygui 资源缓存失败!target,${resh.id},引用次数:${res ? res.refCount : 0}`);
            }
            pauseLoadQueen = false;
        })
        resh.load();
    }

    /**记录引用计数 */
    private cacheRes(context: any, res: ResHandler) {
        if (!context.onDestroy) {
            context.onDestroy = function () { }.bind(context);
        }
        // 记录context中动态加载的资源引用
        context.__resCache = context.__resCache || {};
        if (!context.__resCache[res.id]) {
            res.addRef();
            context.__resCache[res.id] = 1;
        }

        // 继承context的onDestroy
        if (!context.__isReloadOnDestroy) {
            context.__isReloadOnDestroy = true;
            const old = context.onDestroy;
            context.onDestroy = function () {
                old.call(context);
                context.__autoRelease__();
            }.bind(context);

            // 释放函数
            context.__autoRelease__ = function () {
                /**=================== 自动释放相关资源 start =================== */
                if (!context.__resCache) {
                    return;
                }
                for (const resid in context.__resCache) {
                    Loader.inst.removeCacheRes(resid);
                }
                context.__resCache = null;
                /**=================== 自动释放相关资源 end =================== */
            }.bind(context);
        }
    }

    /**
     * 释放资源
     */
    private removeCacheRes(resid: string, clear: boolean = false) {
        const resh = this.resMap[resid]
        if (!resh) {
            return -1;
        }
        resh.delayDecRef(clear);
        return 1;
    }

    public releaseRes(resid: string, clear: boolean = false) {
        return this.removeCacheRes(resid, clear);
    }

    public releaseResImmediate(resid: string) {
        const resh = this.resMap[resid]
        if (!resh) {
            return -1;
        }
        resh.destory();
        return 1;
    }

    // 定时释放
    public onTickClear(dt: number) {
        const now = Date.now();
        for (const key in this.resMap) {
            if (!Object.prototype.hasOwnProperty.call(this.resMap, key)) {
                continue;
            }
            const element = this.resMap[key];
            element.checkRelease(now);
        }
    }
}
