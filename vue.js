class Vue {
    constructor(options) {
        // 1.保存 options的数据
        this.$options = options || {}
        this.$data = options.data || {}
        this.$el = typeof options.el === 'string' ? document.querySelector(options.el) : options.el
        // 2.把 data中的成员转换成 getter和 setter，并注入到 Vue实例中
        this._proxyData(this.$data)
        // 3. 使用Obsever把data中的数据转为响应式 并监测数据的变化，渲染视图
        new Observer(this.$data)
        // 4. 调用 compiler类，解析指令和插值表达式
        new Compiler(this)
    }
    _proxyData(data) {
        // 1.遍历data对象的所有属性 进行数据劫持
        Object.keys(data).forEach(key => {
            /**
             * 语法：Object.defineProperty(obj,property,descriptor)
             *       参数一：obj
             *       绑定属性的目标对象
             *       参数二：property
             *       绑定的属性名
             *       参数三：descriptor
             *       属性描述（配置），且此参数本身为一个对象
             *           属性值1：value 设置属性默认值
             *           属性值2：writable 设置属性是否能够修改
             *           属性值3：enumerable 置属性是否可以枚举，即是否允许遍历
             *           属性值4：configurable 设置属性是否可以删除或编辑
             *           属性值5：get 获取属性的值
             *           属性值6：set 设置属性的值
             *           
            */
            // 2.把data中的属性，转换成vm的getter/setter
            Object.defineProperty(this, key, {
                enumerable: true,
                configurable: true,
                get() {
                    return data[key]
                },
                set(newVal) {
                    if (newVal === data[key]) return
                    data[key] = newVal
                }
            })
        })
    }
}

// 数据劫持
class Observer {
    constructor(data) {
        this.walk(data)
    }
    // 遍历 data中的属性，把属性转换成响应式数据
    walk(data) {
        if (!data || typeof data !== 'object') {
            return
        }
        Object.keys(data).forEach(key => {
            this.defineReactive(data, key, data[key])
        })
    }
    // 定义响应式数据 obj=$data; key=data里面的key; value=key对应的值
    defineReactive(obj, key, value) {
        const that = this
        // 负责收集依赖并发送通知
        let dep = new Dep()
        // 利用递归使深层（内部）属性转换成响应式数据
        this.walk(value)
        Object.defineProperty(obj, key, {
            enumerable: true,
            configurable: true,
            get() {
                // 收集依赖
                Dep.target && dep.addSub(Dep.target)
                return value
            },
            set(newValue) {
                if (value === newValue) return
                value = newValue
                // 如果新设置的值为对象，也转换成响应式数据
                that.walk(newValue)
                // 发送通知
                dep.notify()
            }
        })
    }
}

// 模板编译解析
class Compiler {
    constructor(vm) {
        this.vm = vm
        this.el = vm.$el
        this.init(this.el)
    }
    init(el) {
        const childNodes = el.childNodes
        Array.from(childNodes).forEach(node => {
            // 处理元素节点
            if (node.nodeType === 1) {
                this.compilerElement(node)
            } else if (node.nodeType === 3) {
                // 处理文本节点 
                this.compilerText(node)
            }
            if (node.childNodes.length) {
                this.init(node)
            }
        })
    }
    // 编译文本节点，处理插值表达式
    compilerText(node) {
        const reg = /\{\{(.*?)\}\}/g
        let value = node.textContent
        if (reg.test(value)) {
            node.textContent = value.replace(reg, (match, vmKey) => {
                vmKey = vmKey.trim()
                if (this.vm.hasOwnProperty(vmKey)) {
                    // 创建 Watcher对象，当数据改变时更新视图
                    new Watcher(this.vm, vmKey, (newValue) => {
                        // 仅替换{{}}里面的
                        const text = value.replace(match, newValue)
                        node.textContent = text

                    })
                }
                return this.vm[vmKey.trim()]
            })

        }
    }
    // 编译元素节点，处理指令
    compilerElement(node) {
        // 遍历所有属性节点
        Array.from(node.attributes).forEach(attr => {
            // 判断是否为 v-开头
            let attrName = attr.name
            if (this.isDirective(attrName)) {
                // 为了更优雅的处理不同方法，减去指令中的 v-
                attrName = attrName.substr(2)
                const key = attr.value
                this.update(node, key, attrName)
                // 判断是否为事件 (这里仅简单判断@开头的原生事件，实际源码比这复杂)
            } else if (this.isEvent(attrName)) {
                let subAttrName = attrName.substr(1)
                if (node.hasAttribute(attrName)) {
                    let vmKey = node.getAttribute(attrName).trim()
                    node.addEventListener(subAttrName, (event) => {
                        // 注意这里bing要绑定this.vm
                        this.eventFn = this.vm.$options.methods[vmKey].bind(this.vm)
                        this.eventFn(event)
                    })
                }
            }
        })
    }

    // 执行对应指令的方法
    update(node, key, attrName) {
        let updateFn = this[attrName + 'Updater']
        // 存在指令才执行对应方法
        updateFn && updateFn.call(this, node, this.vm[key], key)
    }

    // v-model指令
    modelUpdater(node, value, key) {
        node.value = value
        // 双向绑定
        node.addEventListener('input', () => {
            this.vm[key] = node.value
        })
    }

    // 判断元素属性是否属于指令
    isDirective(attrName) {
        return attrName.startsWith('v-')
    }
    isEvent(attrName) {
        return attrName.startsWith('@')
    }
}

// 观察者
class Watcher {
    constructor(vm, key, cb) {
        // vue对象
        this.vm = vm
        // data中的属性名
        this.key = key
        // 回调函数负责更新视图
        this.cb = cb

        // 把 watcher对象记录到 Dep类的静态属性 target中
        Dep.target = this
        // 触发 get方法，在 get方法中会调用 addSub
        this.oldValue = vm[key]
        Dep.target = null

    }
    update() {
        const newValue = this.vm[this.key]
        // 数据没有发生变化直接返回
        if (this.oldValue === newValue) return
        // 更新视图
        this.cb(newValue)
        new Compiler(this.vm)
    }
}

// 收集依赖
class Dep {
    constructor() {
        this.subs = []
    }
    addSub(sub) {
        if (sub && sub.update) {
            this.subs.push(sub)
        }
    }
    notify() {
        this.subs.forEach(sub => {
            sub.update()
        })
    }
}