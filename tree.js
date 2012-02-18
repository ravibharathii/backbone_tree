var TreeItem = Backbone.Model.extend({
    defaults: {
        click: false, //optional function that is called when item clicked
        selectable: false,
        selected: false,
        constructor: "item",
        title: '-',
    },
    serialize: function() { 
        data = this.toJSON(); 
        delete data["click"];
        return data;
    },
    deserialize: function(data) { 
        this.set(data); 
    },
    initialize: function() {
        this.bind("click", function() { 
            if( this.get("click") ) {
                this.get("click").call(this);
            }
        });
    }

});

var TreeActionItem = TreeItem.extend({
    defaults: _.extend({}, TreeItem.prototype.defaults, {
        actions: [],
        current_action: undefined,
        constructor: "action_item"
    }),
});


var Folder = Backbone.Model.extend({
    defaults: {
        title: "",
        children: undefined, //new Backbone.Collection(),
        hidden: false,
        selectable: true,
        selected: false,
        constructor: "folder"
    },
    serialize: function() {
        var data = this.toJSON();
        data["children"] = this.get("children").map(function(child) {
            return child.serialize();
        });
        delete data["view_class"];
        return data;
    },
    deserialize: function(data) {
        //we'll be modifying data property, so we better clone it
        var data = _.extend({}, data);

        //convert folder's children into items by initializing their corresponding models
        //and calling deserialize function on them
        data["children"] = _.map(data["children"], function(child_data) {
            var child_class = this.constructors[ child_data["constructor"] ]["model"];
            var child_obj = new child_class();

            child_obj.deserialize(child_data);

            return child_obj;
        }, this);

        //wipe old children and set new ones
        this.get("children").reset( data["children"] );

        //delete the data so that we don't set the list's children to be a serialized array wehen we call 'set'
        delete data["children"];

        //set title and other properties
        this.set(data);
    },
    initialize: function() {
        if( !this.get("children") ) {
            this.set({"children": new Backbone.Collection() });
        }
        if( _.isArray( this.get("children") ) ) {
            this.set({"children": new Backbone.Collection(this.get("children")) });
        } 

        //update the folder's selected status
        this.get("children").bind("change:selected", this.update_selected, this);
        this.get("children").bind("add", this.update_selected, this);
        this.get("children").bind("remove", this.update_selected, this);
        this.update_selected();

        //updates children when folder's selected status chagned
        this.bind("change:selected", function() { 
            var is_selected = this.get("selected");

            //if folder's status is 'mixed', don't propogate that down - this is a
            //folder-specific value
            if( is_selected == "mixed" ) {
                return false;
            }
            this.get("children").each(function(child) {
                child.set({"selected": is_selected});
            });
        });

        //propagate 'save:hidden' status changes up to this folder's parents when a user has clicked a folder
        this.get("children").bind("save:hidden", function(item) {  this.trigger("save:hidden", item); }, this);
    },
    //call when a user interaction results in a hidden status change
    //sets the hidden status of a tree item and triggers a special save:hidden status
    //this allows us to differentiate between user actions and data updates
    save_hidden: function(hidden_status) {
        this.set({"hidden": hidden_status});
        this.trigger("save:hidden", this);
    },
    update_selected: function() {
        var children_selected = [];
        //gets the selected status from all of the folder's selectable children
        var selectable_children = this.get("children").filter(function(child) { return child.get("selectable"); });
        var child_statuses = _.map(selectable_children, function(child) { return child.get("selected"); });
        var child_statuses = _.uniq(child_statuses);

        //calculate the status based on the number of unique child statuses
        switch( child_statuses.length ) {
            case 0:
                var selected = false;
                break;
            case 1:
                var selected = child_statuses[0];
                break;
            default:
                var selected = "mixed";
        }

        this.set({"selected": selected });
    },
    add: function(item, position) {
        this.get("children").add(item, {at:position});
    },
    remove: function(item) {
        this.get("children").remove(item);
    },
    move: function(item, position) {
        var from = this.get("children").indexOf(item);
        var to = parseInt(position);

        if( from == to ) {
            return false;
        }

        var children_arr = this.get("children").models;
        children_arr.splice(to,0, children_arr.splice(from,1)[0]);
        this.trigger("move");
    },

    get_item: function(id, variable_name, type) {
        var item = false;
        var type_class = type ? this.constructors[type]["model"] : undefined;
        variable_name = variable_name || "id";

        this.nested_each(function(child) {
            if( type_class && !(child instanceof type_class) )
                return true;

            if( child.get(variable_name) == id ) {
                item = child;
                return false;
            }
        });
        return item;
    },

    nested_each: function(fn) {
        for( var index in this.get("children").models ) {
            var child = this.get("children").models[index];

            if( child instanceof Folder ) {
                result = child.nested_each(fn);
                if( result === false ) {
                    return false;
                }
            }

            result = fn.call(this, child);
            if( result === false ) {
                return false;
            }

        }
    },

    flatten: function(exclude_folders) {
        //collections are like arrays, but with nice build-in methods
        var list = new Backbone.Collection();

        var add_to_list = function(item, list) {
            //add the item to the list
            if( !(item instanceof Folder) || !exclude_folders ) {
                list.add(item);
            }

            //if the item is a folder, add each of it's children to the list
            if( item instanceof Folder ) {
                item.get("children").each(function(item) {
                    add_to_list(item, list);
                });
            }
        }
        add_to_list(this, list);
        return list;
    },
    selected: function(exclude_folders) {
        items = this.flatten(exclude_folders).filter(function(item) {
            return item.get("selectable") && item.get("selected");
        });
        return new Backbone.Collection(items);
    },

});

//define the various classes for models and views
//of tree types; used for rendering folders with various types
//of children, as well as for serialization and deserialization
Folder.prototype.constructors = {
    "folder": {
        "view": FolderView,
        "model": Folder
    },
    "item": {
        "view": TreeItemView,
        "model": TreeItem
    },
    "action_item": {
        "view": TreeActionItemView,
        "model": TreeActionItem
    }
}


// TREE MODEL & VIEW ///
var Tree = Folder.extend({
    defaults: {
        "sortable": false,
        "show_select_all": false
    }
});
